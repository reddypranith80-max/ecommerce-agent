import { Types } from 'mongoose';
import type { AdminReviewRow, Review as ReviewDTO, ReviewEligibility, ReviewSummary } from '@shop/shared';
import { isDuplicateKeyError } from '../config/db';
import { Product } from '../models/catalog.model';
import { Order } from '../models/order.model';
import { Review } from '../models/shopping.model';
import { User } from '../models/user.model';
import { conflict, notFound, unprocessable } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { audit, type Actor } from './audit.service';
import { recomputeRatings } from './catalog.service';

async function productBySlug(slug: string) {
  const p = await Product.findOne({ slug, status: 'active' }, { _id: 1, name: 1 }).lean();
  if (!p) throw notFound('Product not found.');
  return p;
}

function displayName(name: string) {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? 'Customer');
}

export async function listProductReviews(slug: string, query: { page: number; sort: 'newest' | 'highest' | 'lowest' }) {
  const product = await productBySlug(slug);
  const limit = 10;
  const sort: Record<string, 1 | -1> =
    query.sort === 'highest' ? { rating: -1, createdAt: -1 } : query.sort === 'lowest' ? { rating: 1, createdAt: -1 } : { createdAt: -1 };
  const filter = { productId: product._id, status: 'published' };
  const [items, total, dist] = await Promise.all([
    Review.find(filter).sort(sort).skip(skipFor(query.page, limit)).limit(limit).lean(),
    Review.countDocuments(filter),
    Review.aggregate<{ _id: number; count: number }>([{ $match: filter }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
  ]);
  const users = await User.find({ _id: { $in: items.map((r) => r.userId) } }, { name: 1 }).lean();
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as ReviewSummary['distribution'];
  let sum = 0;
  let count = 0;
  for (const d of dist) {
    distribution[String(d._id) as keyof typeof distribution] = d.count;
    sum += d._id * d.count;
    count += d.count;
  }
  const summary: ReviewSummary = { ratingAvg: count ? Math.round((sum / count) * 10) / 10 : 0, ratingCount: count, distribution };
  const reviews: ReviewDTO[] = items.map((r) => ({
    id: r._id.toString(),
    rating: r.rating,
    title: r.title,
    body: r.body,
    authorName: displayName(names.get(r.userId.toString()) ?? 'Customer'),
    createdAt: r.createdAt.toISOString(),
  }));
  return { items: reviews, meta: pageMeta(query.page, limit, total), summary };
}

async function deliveredOrderFor(userId: string, productId: Types.ObjectId) {
  return Order.findOne({ userId, 'items.productId': productId, status: 'delivered' }, { _id: 1 }).lean();
}

export async function eligibility(userId: string, slug: string): Promise<ReviewEligibility> {
  const product = await productBySlug(slug);
  const existing = await Review.findOne({ productId: product._id, userId }, { _id: 1 }).lean();
  if (existing) return { canReview: false, reason: 'already_reviewed', existingReviewId: existing._id.toString() };
  const order = await deliveredOrderFor(userId, product._id);
  return order ? { canReview: true, reason: null, existingReviewId: null } : { canReview: false, reason: 'not_purchased', existingReviewId: null };
}

export async function createReview(userId: string, slug: string, input: { rating: number; title: string; body: string }) {
  const product = await productBySlug(slug);
  const order = await deliveredOrderFor(userId, product._id);
  if (!order) throw unprocessable('REVIEW_NOT_ALLOWED', 'You can review products from orders that have been delivered to you.');
  try {
    const review = await Review.create({ ...input, productId: product._id, userId, orderId: order._id });
    await recomputeRatings(product._id);
    return { id: review.id as string };
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('DUPLICATE', 'You have already reviewed this product.');
    throw err;
  }
}

export async function updateReview(userId: string, id: string, input: Partial<{ rating: number; title: string; body: string }>) {
  const review = await Review.findOne({ _id: id, userId });
  if (!review) throw notFound('Review not found.');
  review.set(input);
  await review.save();
  await recomputeRatings(review.productId);
  return { id };
}

export async function deleteReview(userId: string, id: string) {
  const review = await Review.findOneAndDelete({ _id: id, userId });
  if (!review) throw notFound('Review not found.');
  await recomputeRatings(review.productId);
}

// ---------------------------------------------------------------- moderation

export async function adminListReviews(query: { page: number; limit: number; status?: 'published' | 'hidden'; q?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Review.countDocuments(filter),
  ]);
  const [users, products] = await Promise.all([
    User.find({ _id: { $in: items.map((r) => r.userId) } }, { name: 1, email: 1 }).lean(),
    Product.find({ _id: { $in: items.map((r) => r.productId) } }, { name: 1, slug: 1 }).lean(),
  ]);
  const u = new Map(users.map((x) => [x._id.toString(), x]));
  const p = new Map(products.map((x) => [x._id.toString(), x]));
  const rows: AdminReviewRow[] = items.map((r) => ({
    id: r._id.toString(),
    rating: r.rating,
    title: r.title,
    body: r.body,
    authorName: u.get(r.userId.toString())?.name ?? 'Unknown',
    authorEmail: u.get(r.userId.toString())?.email ?? '',
    createdAt: r.createdAt.toISOString(),
    status: r.status as 'published' | 'hidden',
    productName: p.get(r.productId.toString())?.name ?? 'Deleted product',
    productSlug: p.get(r.productId.toString())?.slug ?? '',
  }));
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function moderateReview(actor: Actor, id: string, status: 'published' | 'hidden') {
  const review = await Review.findByIdAndUpdate(id, { $set: { status, moderatedBy: actor.id, moderatedAt: new Date() } }, { new: true });
  if (!review) throw notFound('Review not found.');
  await recomputeRatings(review.productId);
  await audit(actor, `review.${status}`, 'review', id);
}

export async function adminDeleteReview(actor: Actor, id: string) {
  const review = await Review.findByIdAndDelete(id);
  if (!review) throw notFound('Review not found.');
  await recomputeRatings(review.productId);
  await audit(actor, 'review.delete', 'review', id);
}
