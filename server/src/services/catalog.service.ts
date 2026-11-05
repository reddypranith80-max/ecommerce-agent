import { Types, type FilterQuery } from 'mongoose';
import type {
  CategoryNode,
  HomeData,
  ProductCard,
  ProductDetail,
  ProductListQuery,
  ProductListResponse,
  StockStatus,
} from '@shop/shared';
import { discountPercent } from '@shop/shared';
import { mediaUrl } from '../integrations/storage';
import { Category, Inventory, Product, type ProductLean } from '../models/catalog.model';
import { Order } from '../models/order.model';
import { escapeRegex } from '../utils/crypto';
import { notFound } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { searchTokens } from '../utils/text';
import { getSettings } from './settings.service';

const CARD_FIELDS =
  'name slug brand images priceMin priceMax compareAtPrice maxDiscountPct ratingAvg ratingCount stockStatus' as const;
const QUERY_TIMEOUT_MS = 3000;

type CardSource = Pick<
  ProductLean,
  'name' | 'slug' | 'brand' | 'images' | 'priceMin' | 'priceMax' | 'compareAtPrice' | 'maxDiscountPct' | 'ratingAvg' | 'ratingCount' | 'stockStatus'
> & { _id: Types.ObjectId };

export function toCard(p: CardSource): ProductCard {
  const first = p.images?.[0];
  return {
    id: p._id.toString(),
    slug: p.slug,
    name: p.name,
    brand: p.brand ?? null,
    imageUrl: first ? mediaUrl(first.thumbKey) : null,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    compareAtPrice: p.compareAtPrice ?? null,
    maxDiscountPct: p.maxDiscountPct,
    ratingAvg: Math.round(p.ratingAvg * 10) / 10,
    ratingCount: p.ratingCount,
    stockStatus: p.stockStatus as StockStatus,
  };
}

// ---------------------------------------------------------------- categories

export async function getCategoryTree(includeInactive = false): Promise<CategoryNode[]> {
  const cats = await Category.find(includeInactive ? {} : { isActive: true }).sort({ depth: 1, sortOrder: 1, name: 1 }).lean();
  const nodes = new Map<string, CategoryNode>();
  for (const c of cats) {
    nodes.set(c._id.toString(), {
      id: c._id.toString(),
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      parentId: c.parentId ? c.parentId.toString() : null,
      depth: c.depth,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      imageUrl: mediaUrl(c.imageKey),
      version: (c as { __v?: number }).__v ?? 0,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!node.parentId) roots.push(node);
  }
  return roots;
}

export async function getCategoryBySlug(slug: string) {
  const cat = await Category.findOne({ slug, isActive: true }).lean();
  if (!cat) throw notFound('Category not found.');
  const [ancestors, children] = await Promise.all([
    Category.find({ _id: { $in: cat.ancestors } }).lean(),
    Category.find({ parentId: cat._id, isActive: true }).sort({ sortOrder: 1 }).lean(),
  ]);
  const byId = new Map(ancestors.map((a) => [a._id.toString(), a]));
  return {
    id: cat._id.toString(),
    name: cat.name,
    slug: cat.slug,
    description: cat.description ?? null,
    breadcrumb: [...cat.ancestors.map((id) => byId.get(id.toString())).filter(Boolean), cat].map((c) => ({
      name: c!.name,
      slug: c!.slug,
    })),
    children: children.map((c) => ({ id: c._id.toString(), name: c.name, slug: c.slug })),
  };
}

// ---------------------------------------------------------------- storefront listing

const SORTS: Record<string, Record<string, 1 | -1 | { $meta: 'textScore' }>> = {
  newest: { publishedAt: -1, _id: -1 },
  popular: { soldCount: -1, _id: -1 },
  price_asc: { priceMin: 1, _id: 1 },
  price_desc: { priceMin: -1, _id: -1 },
  rating: { ratingAvg: -1, ratingCount: -1, _id: -1 },
};

export async function listProducts(query: ProductListQuery): Promise<ProductListResponse> {
  const base: FilterQuery<ProductLean> = { status: 'active' };
  if (query.category) {
    const cat = await Category.findOne({ slug: query.category, isActive: true }, { _id: 1 }).lean();
    if (!cat) return { data: [], meta: { ...pageMeta(query.page, query.limit, 0), priceBounds: { min: 0, max: 0 } } };
    base.categoryPath = cat._id;
  }
  if (query.rating) base.ratingAvg = { $gte: query.rating };
  if (query.inStock) base.stockStatus = { $ne: 'out_of_stock' };

  // Keyword search: stemmed full-text search first; if nothing matches, fall back to word-prefix matching.
  let textMode = false;
  if (query.q) {
    const textCount = await Product.countDocuments({ ...base, $text: { $search: query.q } }).maxTimeMS(QUERY_TIMEOUT_MS);
    if (textCount > 0) {
      base.$text = { $search: query.q };
      textMode = true;
    } else {
      const words = searchTokens(query.q).slice(0, 5);
      if (words.length === 0) return { data: [], meta: { ...pageMeta(query.page, query.limit, 0), priceBounds: { min: 0, max: 0 } } };
      base.searchTokens = { $all: words.map((w) => new RegExp(`^${escapeRegex(w)}`)) };
    }
  }

  const filter: FilterQuery<ProductLean> = { ...base };
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.priceMin = {
      ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
    };
  }

  const sortKey = query.sort ?? (textMode ? 'relevance' : 'newest');
  const sort = sortKey === 'relevance' ? (textMode ? { score: { $meta: 'textScore' as const }, _id: -1 as const } : SORTS.newest!) : SORTS[sortKey]!;
  const projection = textMode ? { score: { $meta: 'textScore' } } : {};

  const [items, total, bounds] = await Promise.all([
    Product.find(filter, projection)
      .select(CARD_FIELDS)
      .sort(sort)
      .skip(skipFor(query.page, query.limit))
      .limit(query.limit)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean(),
    Product.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS),
    Product.aggregate<{ min: number; max: number }>([
      { $match: base },
      { $group: { _id: null, min: { $min: '$priceMin' }, max: { $max: '$priceMin' } } },
    ]).option({ maxTimeMS: QUERY_TIMEOUT_MS }),
  ]);

  return {
    data: items.map((p) => toCard(p as CardSource)),
    meta: { ...pageMeta(query.page, query.limit, total), priceBounds: { min: bounds[0]?.min ?? 0, max: bounds[0]?.max ?? 0 } },
  };
}

export async function suggestProducts(q: string) {
  const words = searchTokens(q).slice(0, 5);
  if (words.length === 0) return [];
  const items = await Product.find({
    status: 'active',
    searchTokens: { $all: words.map((w) => new RegExp(`^${escapeRegex(w)}`)) },
  })
    .select('name slug images')
    .sort({ soldCount: -1 })
    .limit(8)
    .maxTimeMS(QUERY_TIMEOUT_MS)
    .lean();
  return items.map((p) => ({ name: p.name, slug: p.slug, imageUrl: p.images[0] ? mediaUrl(p.images[0].thumbKey) : null }));
}

export async function getCards(ids: string[]): Promise<ProductCard[]> {
  const items = await Product.find({ _id: { $in: ids }, status: 'active' }).select(CARD_FIELDS).lean();
  const byId = new Map(items.map((p) => [p._id.toString(), p]));
  return ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => toCard(p as CardSource));
}

export async function getProductDetail(slug: string): Promise<ProductDetail> {
  const p = await Product.findOne({ slug, status: 'active' }).lean();
  if (!p) throw notFound('Product not found.');
  const [inventory, category, ancestors] = await Promise.all([
    Inventory.find({ productId: p._id }).lean(),
    Category.findById(p.categoryId).lean(),
    Category.find({ _id: { $in: p.categoryPath } }).lean(),
  ]);
  const stock = new Map(inventory.map((i) => [i.sku, i.available]));
  const catById = new Map(ancestors.map((c) => [c._id.toString(), c]));
  return {
    ...toCard(p as CardSource),
    description: p.description,
    tags: p.tags,
    images: p.images.map((img) => ({
      mediaId: img.mediaId.toString(),
      url: mediaUrl(img.key)!,
      thumbUrl: mediaUrl(img.thumbKey)!,
      alt: img.alt || p.name,
      width: img.width,
      height: img.height,
    })),
    category: { id: p.categoryId.toString(), name: category?.name ?? '', slug: category?.slug ?? '' },
    breadcrumb: p.categoryPath
      .map((id) => catById.get(id.toString()))
      .filter(Boolean)
      .map((c) => ({ name: c!.name, slug: c!.slug })),
    options: p.options.map((o) => ({ name: o.name ?? '', values: o.values ?? [] })),
    variants: p.variants
      .filter((v) => v.isActive)
      .map((v) => {
        const available = stock.get(v.sku) ?? 0;
        return {
          id: v._id.toString(),
          sku: v.sku,
          optionValues: (v.optionValues ?? {}) as Record<string, string>,
          price: v.price,
          compareAtPrice: v.compareAtPrice ?? null,
          available: Math.min(available, 10),
          inStock: available > 0,
        };
      }),
  };
}

export async function getRelated(slug: string): Promise<ProductCard[]> {
  const p = await Product.findOne({ slug, status: 'active' }, { categoryId: 1 }).lean();
  if (!p) throw notFound('Product not found.');
  const items = await Product.find({ status: 'active', categoryPath: p.categoryId, _id: { $ne: p._id } })
    .select(CARD_FIELDS)
    .sort({ soldCount: -1 })
    .limit(8)
    .lean();
  return items.map((i) => toCard(i as CardSource));
}

export async function getHome(): Promise<HomeData> {
  const [settings, categories, featured, offers, newArrivals, trending] = await Promise.all([
    getSettings(),
    Category.find({ isActive: true, depth: 0 }).sort({ sortOrder: 1 }).lean(),
    Product.find({ status: 'active', isFeatured: true }).select(CARD_FIELDS).sort({ publishedAt: -1 }).limit(8).lean(),
    Product.find({ status: 'active', maxDiscountPct: { $gt: 0 } }).select(CARD_FIELDS).sort({ maxDiscountPct: -1 }).limit(8).lean(),
    Product.find({ status: 'active' }).select(CARD_FIELDS).sort({ publishedAt: -1 }).limit(8).lean(),
    Product.find({ status: 'active' }).select(CARD_FIELDS).sort({ soldCount: -1 }).limit(8).lean(),
  ]);
  return {
    hero: { title: settings.heroTitle, subtitle: settings.heroSubtitle },
    categories: categories.map((c) => ({ id: c._id.toString(), name: c.name, slug: c.slug, imageUrl: mediaUrl(c.imageKey) })),
    featured: featured.map((p) => toCard(p as CardSource)),
    offers: offers.map((p) => toCard(p as CardSource)),
    newArrivals: newArrivals.map((p) => toCard(p as CardSource)),
    trending: trending.map((p) => toCard(p as CardSource)),
  };
}

/** Rule-based personalisation: best sellers from categories the customer has bought from. */
export async function getRecommended(userId: string): Promise<ProductCard[]> {
  const orders = await Order.find({ userId, status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] } })
    .select('items.productId')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  const purchased = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId.toString())))];
  if (purchased.length === 0) {
    const trending = await Product.find({ status: 'active' }).select(CARD_FIELDS).sort({ soldCount: -1 }).limit(8).lean();
    return trending.map((p) => toCard(p as CardSource));
  }
  const bought = await Product.find({ _id: { $in: purchased } }, { categoryId: 1 }).lean();
  const categoryIds = [...new Set(bought.map((b) => b.categoryId.toString()))].map((id) => new Types.ObjectId(id));
  const items = await Product.find({
    status: 'active',
    categoryPath: { $in: categoryIds },
    _id: { $nin: purchased.map((id) => new Types.ObjectId(id)) },
  })
    .select(CARD_FIELDS)
    .sort({ soldCount: -1 })
    .limit(8)
    .lean();
  return items.map((p) => toCard(p as CardSource));
}

// ---------------------------------------------------------------- aggregates

/**
 * The only writer of product aggregate fields (price range, discount, stock status, sales count).
 * Called after commit by every operation that changes prices, variants or stock, and nightly as a repair.
 */
export async function recomputeProductAggregates(productIds: (string | Types.ObjectId)[]): Promise<void> {
  const ids = [...new Set(productIds.map(String))].map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return;
  const [products, inventory, sales] = await Promise.all([
    Product.find({ _id: { $in: ids } }).select('variants').lean(),
    Inventory.find({ productId: { $in: ids } }).lean(),
    Order.aggregate<{ _id: Types.ObjectId; units: number }>([
      { $match: { 'items.productId': { $in: ids }, status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] } } },
      { $unwind: '$items' },
      { $match: { 'items.productId': { $in: ids } } },
      { $group: { _id: '$items.productId', units: { $sum: '$items.quantity' } } },
    ]),
  ]);
  const soldBy = new Map(sales.map((s) => [s._id.toString(), s.units]));

  const inventoryOps = inventory.map((inv) => ({
    updateOne: {
      filter: { _id: inv._id },
      update: { $set: { isLowStock: inv.available <= inv.lowStockThreshold } },
    },
  }));

  const productOps = products.map((p) => {
    const active = p.variants.filter((v) => v.isActive);
    const priced = active.length > 0 ? active : p.variants;
    const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a), priced[0]!);
    const prices = priced.map((v) => v.price);
    const skus = new Set(active.map((v) => v.sku));
    const stock = inventory.filter((i) => skus.has(i.sku));
    const totalAvailable = stock.reduce((s, i) => s + i.available, 0);
    const anyLow = stock.some((i) => i.available > 0 && i.available <= i.lowStockThreshold);
    const stockStatus: StockStatus = totalAvailable === 0 ? 'out_of_stock' : anyLow && totalAvailable <= 10 ? 'low_stock' : 'in_stock';
    return {
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            priceMin: prices.length ? Math.min(...prices) : 0,
            priceMax: prices.length ? Math.max(...prices) : 0,
            compareAtPrice: cheapest?.compareAtPrice ?? null,
            maxDiscountPct: Math.max(0, ...priced.map((v) => discountPercent(v.price, v.compareAtPrice))),
            stockStatus,
            soldCount: soldBy.get(p._id.toString()) ?? 0,
          },
        },
      },
    };
  });

  await Promise.all([
    inventoryOps.length ? Inventory.bulkWrite(inventoryOps) : null,
    // Bypass optimistic concurrency: aggregates must not bump the admin-facing version.
    productOps.length ? Product.collection.bulkWrite(productOps) : null,
  ]);
}

export async function recomputeAllProductAggregates(): Promise<number> {
  const ids = await Product.find({}, { _id: 1 }).lean();
  for (let i = 0; i < ids.length; i += 200) {
    await recomputeProductAggregates(ids.slice(i, i + 200).map((p) => p._id));
  }
  return ids.length;
}

export async function recomputeRatings(productId: Types.ObjectId | string): Promise<void> {
  const { Review } = await import('../models/shopping.model');
  const pid = new Types.ObjectId(String(productId));
  const [agg] = await Review.aggregate<{ avg: number; count: number }>([
    { $match: { productId: pid, status: 'published' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.collection.updateOne({ _id: pid }, { $set: { ratingAvg: agg?.avg ?? 0, ratingCount: agg?.count ?? 0 } });
}
