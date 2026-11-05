import { z } from 'zod';
import {
  cancelOrderSchema,
  cartItemInputSchema,
  cartItemsSchema,
  cartQuantitySchema,
  objectId,
  orderListQuerySchema,
  placeOrderSchema,
  productCardsSchema,
  productListQuerySchema,
  quoteSchema,
  reviewListQuerySchema,
  reviewSchema,
  reviewUpdateSchema,
  suggestQuerySchema,
  verifyPaymentSchema,
} from '@shop/shared';
import { actorOf, auth } from '../middleware/auth';
import { handle } from '../middleware/handle';
import * as cart from '../services/cart.service';
import * as catalog from '../services/catalog.service';
import * as orders from '../services/order.service';
import * as payments from '../services/payment.service';
import * as reviews from '../services/review.service';
import { getPublicConfig } from '../services/settings.service';
import { AppError } from '../utils/errors';

const slugParams = z.object({ slug: z.string().min(1).max(120) });
const orderParams = z.object({ orderNumber: z.string().regex(/^ORD-\d{6}-[0-9A-Z]{6}$/, 'Invalid order number.') });
const idParams = z.object({ id: objectId });
const itemParams = z.object({ itemId: objectId });
const productParams = z.object({ productId: objectId });
const pageQuery = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }).strict();

const publicCache = (res: import('express').Response) => res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

// ---------------------------------------------------------------- catalog
export const config = handle({}, async () => getPublicConfig());
export const home = handle({}, async ({ res }) => {
  publicCache(res);
  return catalog.getHome();
});
export const recommended = handle({}, async ({ req, res }) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return catalog.getRecommended(auth(req).userId);
});
export const categories = handle({}, async ({ res }) => {
  publicCache(res);
  return catalog.getCategoryTree();
});
export const category = handle({ params: slugParams }, async ({ params }) => catalog.getCategoryBySlug(params.slug));
export const products = handle({ query: productListQuerySchema }, async ({ res, query }) => {
  publicCache(res);
  const result = await catalog.listProducts(query);
  res.json(result);
});
export const suggest = handle({ query: suggestQuerySchema }, async ({ query }) => catalog.suggestProducts(query.q));
export const cards = handle({ body: productCardsSchema }, async ({ body }) => catalog.getCards(body.ids));
export const product = handle({ params: slugParams }, async ({ params }) => catalog.getProductDetail(params.slug));
export const related = handle({ params: slugParams }, async ({ params }) => catalog.getRelated(params.slug));

// ---------------------------------------------------------------- reviews
export const productReviews = handle({ params: slugParams, query: reviewListQuerySchema }, async ({ res, params, query }) => {
  const result = await reviews.listProductReviews(params.slug, query);
  res.json({ data: result.items, meta: result.meta, summary: result.summary });
});
export const reviewEligibility = handle({ params: slugParams }, async ({ req, params }) => reviews.eligibility(auth(req).userId, params.slug));
export const createReview = handle({ params: slugParams, body: reviewSchema }, async ({ req, params, body }) =>
  reviews.createReview(auth(req).userId, params.slug, body), { status: 201 },
);
export const updateReview = handle({ params: idParams, body: reviewUpdateSchema }, async ({ req, params, body }) =>
  reviews.updateReview(auth(req).userId, params.id, body),
);
export const deleteReview = handle({ params: idParams }, async ({ req, params }) => {
  await reviews.deleteReview(auth(req).userId, params.id);
});

// ---------------------------------------------------------------- cart & wishlist
export const previewCart = handle({ body: cartItemsSchema }, async ({ body }) => cart.previewCart(body.items));
export const getCart = handle({}, async ({ req }) => cart.getCart(auth(req).userId));
export const addCartItem = handle({ body: cartItemInputSchema }, async ({ req, body }) => cart.addItem(auth(req).userId, body));
export const updateCartItem = handle({ params: itemParams, body: cartQuantitySchema }, async ({ req, params, body }) =>
  cart.updateItem(auth(req).userId, params.itemId, body.quantity),
);
export const removeCartItem = handle({ params: itemParams }, async ({ req, params }) => cart.removeItem(auth(req).userId, params.itemId));
export const clearCart = handle({}, async ({ req }) => cart.clearCart(auth(req).userId));
export const mergeCart = handle({ body: cartItemsSchema }, async ({ req, body }) => cart.mergeGuestCart(auth(req).userId, body.items));

export const wishlist = handle({ query: pageQuery }, async ({ req, res, query }) => {
  const result = await cart.listWishlist(auth(req).userId, query.page);
  res.json({ data: result.items, meta: result.meta });
});
export const wishlistIds = handle({}, async ({ req }) => cart.wishlistIds(auth(req).userId));
export const addWishlist = handle({ params: productParams }, async ({ req, params }) => {
  await cart.addToWishlist(auth(req).userId, params.productId);
});
export const removeWishlist = handle({ params: productParams }, async ({ req, params }) => {
  await cart.removeFromWishlist(auth(req).userId, params.productId);
});

// ---------------------------------------------------------------- checkout & orders
const idempotencyKey = z.string().regex(/^[A-Za-z0-9-]{8,100}$/);

export const checkoutQuote = handle({ body: quoteSchema }, async ({ req, body }) => orders.quote(auth(req).userId, body));

export const placeOrder = handle({ body: placeOrderSchema }, async ({ req, body }) => {
  const key = idempotencyKey.safeParse(req.headers['idempotency-key']);
  if (!key.success) throw new AppError(400, 'VALIDATION_ERROR', 'A valid Idempotency-Key header is required.');
  return orders.placeOrder(auth(req).user, body, key.data);
}, { status: 201 });

export const myOrders = handle({ query: orderListQuerySchema }, async ({ req, res, query }) => {
  const result = await orders.listMyOrders(auth(req).userId, query);
  res.json({ data: result.items, meta: result.meta });
});
export const myOrder = handle({ params: orderParams }, async ({ req, params }) => orders.getMyOrder(auth(req).userId, params.orderNumber));
export const cancelMyOrder = handle({ params: orderParams, body: cancelOrderSchema }, async ({ req, params, body }) => {
  await orders.cancelOrder(actorOf(req), params.orderNumber, body.reason, { userId: auth(req).userId });
  return orders.getMyOrder(auth(req).userId, params.orderNumber);
});
export const startPayment = handle({ params: orderParams }, async ({ req, params }) => payments.startPayment(auth(req).userId, params.orderNumber));
export const verifyPayment = handle({ body: verifyPaymentSchema }, async ({ req, body }) => payments.verifyPayment(auth(req).userId, body));
