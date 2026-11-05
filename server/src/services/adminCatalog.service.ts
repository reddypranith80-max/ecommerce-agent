import { Types, type ClientSession } from 'mongoose';
import sharp from 'sharp';
import type { AdminProduct, AdminProductRow, MediaUpload, ProductInput } from '@shop/shared';
import { isDuplicateKeyError, withTransaction } from '../config/db';
import { mediaUrl, storage } from '../integrations/storage';
import { Category, Inventory, InventoryMovement, Media, Product } from '../models/catalog.model';
import { getSettings } from './settings.service';
import { randomToken, escapeRegex } from '../utils/crypto';
import { AppError, conflict, notFound } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { searchTokens, slugify, variantLabel } from '../utils/text';
import { audit, type Actor } from './audit.service';
import { recomputeProductAggregates } from './catalog.service';

sharp.concurrency(1);
const MAX_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

// ---------------------------------------------------------------- media

/** Re-encodes an uploaded image (rejects non-images, strips metadata, auto-rotates, resizes) and stores it. */
export async function storeImage(buffer: Buffer, folder: string, uploadedBy?: Types.ObjectId | string) {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not a supported image.');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload JPEG, PNG, WebP or AVIF images.');
  }
  const main = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const now = new Date();
  const base = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(12)}`;
  const key = `${base}.webp`;
  const thumbKey = `${base}-thumb.webp`;
  await storage.put(key, main.data, 'image/webp');
  await storage.put(thumbKey, thumb, 'image/webp');
  return Media.create({ key, thumbKey, width: main.info.width, height: main.info.height, bytes: main.info.size, uploadedBy });
}

export async function uploadMedia(actor: Actor, files: { buffer: Buffer }[]): Promise<MediaUpload[]> {
  const out: MediaUpload[] = [];
  for (const file of files) {
    // One at a time: bounds memory and CPU used by image processing.
    const media = await storeImage(file.buffer, 'products', actor.id);
    out.push({ id: media.id as string, url: mediaUrl(media.key)!, thumbUrl: mediaUrl(media.thumbKey)!, width: media.width, height: media.height });
  }
  return out;
}

export async function cleanupOrphanMedia(olderThanMs = 24 * 3600 * 1000) {
  const stale = await Media.find({ attachedTo: { $exists: false }, createdAt: { $lt: new Date(Date.now() - olderThanMs) } }).limit(100);
  for (const m of stale) {
    await storage.remove(m.key);
    await storage.remove(m.thumbKey);
    await m.deleteOne();
  }
  return stale.length;
}

// ---------------------------------------------------------------- categories

export async function createCategory(actor: Actor, input: { name: string; slug?: string; parentId?: string | null; description?: string; sortOrder?: number; isActive?: boolean }) {
  let ancestors: Types.ObjectId[] = [];
  let depth = 0;
  if (input.parentId) {
    const parent = await Category.findById(input.parentId);
    if (!parent) throw notFound('Parent category not found.');
    if (parent.depth >= 2) throw new AppError(400, 'VALIDATION_ERROR', 'Categories can be at most 3 levels deep.');
    ancestors = [...parent.ancestors, parent._id];
    depth = parent.depth + 1;
  }
  try {
    const cat = await Category.create({
      name: input.name,
      slug: input.slug || slugify(input.name),
      parentId: input.parentId ?? null,
      ancestors,
      depth,
      description: input.description,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });
    await audit(actor, 'category.create', 'category', cat.id as string, cat.name);
    return { id: cat.id as string };
  } catch (err) {
    if (isDuplicateKeyError(err, 'slug')) throw conflict('DUPLICATE', 'A category with this slug already exists.');
    throw err;
  }
}

export async function updateCategory(
  actor: Actor,
  id: string,
  input: { version: number; name?: string; slug?: string; parentId?: string | null; description?: string; sortOrder?: number; isActive?: boolean },
) {
  const cat = await Category.findById(id);
  if (!cat) throw notFound('Category not found.');
  if ((cat.__v ?? 0) !== input.version) throw conflict('STALE_VERSION', 'This category was changed by someone else. Reload and try again.');
  const { version: _v, parentId, ...rest } = input;
  if (parentId !== undefined && String(parentId ?? '') !== String(cat.parentId ?? '')) {
    const [children, products] = await Promise.all([Category.exists({ parentId: cat._id }), Product.exists({ categoryPath: cat._id })]);
    if (children || products) throw conflict('CATEGORY_NOT_EMPTY', 'Only empty categories can be moved.');
    if (parentId) {
      if (parentId === id) throw new AppError(400, 'VALIDATION_ERROR', 'A category cannot be its own parent.');
      const parent = await Category.findById(parentId);
      if (!parent) throw notFound('Parent category not found.');
      if (parent.depth >= 2) throw new AppError(400, 'VALIDATION_ERROR', 'Categories can be at most 3 levels deep.');
      cat.parentId = parent._id;
      cat.ancestors = [...parent.ancestors, parent._id];
      cat.depth = parent.depth + 1;
    } else {
      cat.parentId = null;
      cat.ancestors = [];
      cat.depth = 0;
    }
  }
  cat.set(rest);
  try {
    await cat.save();
  } catch (err) {
    if (isDuplicateKeyError(err, 'slug')) throw conflict('DUPLICATE', 'A category with this slug already exists.');
    throw err;
  }
  await audit(actor, 'category.update', 'category', id, Object.keys(rest).join(', '));
  return { id };
}

export async function deleteCategory(actor: Actor, id: string) {
  const [children, products] = await Promise.all([Category.exists({ parentId: id }), Product.exists({ categoryPath: id })]);
  if (children || products) throw conflict('CATEGORY_NOT_EMPTY', 'Remove its subcategories and products first.');
  const res = await Category.deleteOne({ _id: id });
  if (res.deletedCount === 0) throw notFound('Category not found.');
  await audit(actor, 'category.delete', 'category', id);
}

// ---------------------------------------------------------------- products

export async function adminListProducts(query: { page: number; limit: number; q?: string; status?: string; category?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.categoryPath = new Types.ObjectId(query.category);
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { 'variants.sku': query.q.toUpperCase() }, { brand: rx }];
  }
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Product.countDocuments(filter),
  ]);
  const [cats, stock] = await Promise.all([
    Category.find({ _id: { $in: items.map((p) => p.categoryId) } }, { name: 1 }).lean(),
    Inventory.aggregate<{ _id: Types.ObjectId; available: number }>([
      { $match: { productId: { $in: items.map((p) => p._id) } } },
      { $group: { _id: '$productId', available: { $sum: '$available' } } },
    ]),
  ]);
  const catName = new Map(cats.map((c) => [c._id.toString(), c.name]));
  const avail = new Map(stock.map((s) => [s._id.toString(), s.available]));
  const rows: AdminProductRow[] = items.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    slug: p.slug,
    status: p.status as AdminProductRow['status'],
    categoryName: catName.get(p.categoryId.toString()) ?? '—',
    imageUrl: p.images[0] ? mediaUrl(p.images[0].thumbKey) : null,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    variantCount: p.variants.length,
    stockStatus: p.stockStatus as AdminProductRow['stockStatus'],
    totalAvailable: avail.get(p._id.toString()) ?? 0,
    updatedAt: p.updatedAt.toISOString(),
  }));
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function adminGetProduct(id: string): Promise<AdminProduct> {
  const p = await Product.findById(id).lean();
  if (!p) throw notFound('Product not found.');
  const inventory = await Inventory.find({ productId: p._id }).lean();
  const inv = new Map(inventory.map((i) => [i.sku, i]));
  return {
    id: p._id.toString(),
    version: (p as { __v?: number }).__v ?? 0,
    name: p.name,
    slug: p.slug,
    description: p.description,
    brand: p.brand ?? null,
    tags: p.tags,
    categoryId: p.categoryId.toString(),
    status: p.status as AdminProduct['status'],
    isFeatured: p.isFeatured,
    everOrdered: p.everOrdered,
    options: p.options.map((o) => ({ name: o.name ?? '', values: o.values ?? [] })),
    variants: p.variants.map((v) => {
      const i = inv.get(v.sku);
      return {
        id: v._id.toString(),
        sku: v.sku,
        optionValues: (v.optionValues ?? {}) as Record<string, string>,
        price: v.price,
        compareAtPrice: v.compareAtPrice ?? null,
        isActive: v.isActive,
        available: i?.available ?? 0,
        reserved: i?.reserved ?? 0,
        allocated: i?.allocated ?? 0,
        lowStockThreshold: i?.lowStockThreshold ?? 5,
      };
    }),
    images: p.images.map((img) => ({
      mediaId: img.mediaId.toString(),
      url: mediaUrl(img.key)!,
      thumbUrl: mediaUrl(img.thumbKey)!,
      alt: img.alt,
      width: img.width,
      height: img.height,
    })),
    hsnCode: p.hsnCode ?? null,
    gstRate: p.gstRate ?? null,
  };
}

async function resolveCategory(categoryId: string, session: ClientSession) {
  const cat = await Category.findById(categoryId).session(session);
  if (!cat) throw notFound('Category not found.');
  return [...cat.ancestors, cat._id];
}

async function resolveImages(images: ProductInput['images'], productId: Types.ObjectId, session: ClientSession) {
  const media = await Media.find({ _id: { $in: images.map((i) => i.mediaId) } }).session(session);
  const byId = new Map(media.map((m) => [m.id as string, m]));
  const resolved = images.map((img) => {
    const m = byId.get(img.mediaId);
    if (!m) throw notFound('An image was not found. Upload it again.');
    if (m.attachedTo && !m.attachedTo.equals(productId)) throw conflict('DUPLICATE', 'An image belongs to another product.');
    return { mediaId: m._id, key: m.key, thumbKey: m.thumbKey, alt: img.alt, width: m.width, height: m.height };
  });
  await Media.updateMany({ _id: { $in: media.map((m) => m._id) } }, { $set: { attachedTo: productId } }, { session });
  return resolved;
}

async function uniqueSlug(base: string, excludeId?: Types.ObjectId) {
  const root = slugify(base) || 'product';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await Product.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!taken) return candidate;
  }
  return `${root}-${randomToken(4).toLowerCase()}`;
}

function skuConflict(err: unknown): never {
  if (isDuplicateKeyError(err, 'variants.sku') || isDuplicateKeyError(err, 'sku')) {
    throw conflict('DUPLICATE', 'One of these SKUs is already used by another product.');
  }
  if (isDuplicateKeyError(err, 'slug')) throw conflict('DUPLICATE', 'Another product already uses this URL slug.');
  throw err;
}

export async function createProduct(actor: Actor, input: ProductInput) {
  const settings = await getSettings();
  const productId = new Types.ObjectId();
  const slug = input.slug ? input.slug : await uniqueSlug(input.name);
  try {
    await withTransaction(async (session) => {
      const categoryPath = await resolveCategory(input.categoryId, session);
      const images = await resolveImages(input.images, productId, session);
      const variants = input.variants.map((v) => ({
        _id: new Types.ObjectId(),
        sku: v.sku,
        optionValues: v.optionValues,
        price: v.price,
        compareAtPrice: v.compareAtPrice || null,
        isActive: v.isActive,
      }));
      await Product.create(
        [{
          _id: productId,
          name: input.name,
          slug,
          description: input.description,
          brand: input.brand,
          tags: input.tags,
          searchTokens: searchTokens(input.name, input.brand),
          categoryId: input.categoryId,
          categoryPath,
          images,
          options: input.options,
          variants,
          status: input.status,
          isFeatured: input.isFeatured,
          hsnCode: input.hsnCode,
          gstRate: input.gstRate,
          publishedAt: input.status === 'active' ? new Date() : undefined,
        }],
        { session },
      );
      await Inventory.insertMany(
        variants.map((v, i) => ({
          sku: v.sku,
          productId,
          variantId: v._id,
          available: input.variants[i]!.initialStock ?? 0,
          reserved: 0,
          allocated: 0,
          lowStockThreshold: input.variants[i]!.lowStockThreshold ?? settings.defaultLowStockThreshold,
        })),
        { session },
      );
      await InventoryMovement.insertMany(
        variants.map((v, i) => ({
          sku: v.sku,
          productId,
          type: 'initial',
          delta: { available: input.variants[i]!.initialStock ?? 0, reserved: 0, allocated: 0 },
          actorId: actor.id,
          reason: 'Opening stock',
        })),
        { session },
      );
    });
  } catch (err) {
    skuConflict(err);
  }
  await recomputeProductAggregates([productId]);
  await audit(actor, 'product.create', 'product', productId.toString(), input.name);
  return { id: productId.toString(), slug };
}

export async function updateProduct(actor: Actor, id: string, input: ProductInput & { version: number }) {
  const settings = await getSettings();
  try {
    await withTransaction(async (session) => {
      const product = await Product.findById(id).session(session);
      if (!product) throw notFound('Product not found.');
      if ((product.__v ?? 0) !== input.version) {
        throw conflict('STALE_VERSION', 'This product was changed by someone else. Reload and try again.');
      }
      const existing = new Map(product.variants.map((v) => [v._id.toString(), v]));
      const keptIds = new Set<string>();
      const nextVariants = input.variants.map((v) => {
        if (v.id) {
          const current = existing.get(v.id);
          if (!current) throw notFound('A variant no longer exists. Reload and try again.');
          if (current.sku !== v.sku) throw conflict('VALIDATION_ERROR', `SKU ${current.sku} cannot be changed once created.`);
          keptIds.add(v.id);
          return { _id: current._id, sku: v.sku, optionValues: v.optionValues, price: v.price, compareAtPrice: v.compareAtPrice || null, isActive: v.isActive };
        }
        return { _id: new Types.ObjectId(), sku: v.sku, optionValues: v.optionValues, price: v.price, compareAtPrice: v.compareAtPrice || null, isActive: v.isActive, isNew: true };
      });
      const removed = product.variants.filter((v) => !keptIds.has(v._id.toString()));
      if (removed.length > 0) {
        if (product.everOrdered) {
          throw conflict('VALIDATION_ERROR', 'Variants of a product that has been ordered cannot be removed. Deactivate them instead.');
        }
        await Inventory.deleteMany({ sku: { $in: removed.map((v) => v.sku) } }, { session });
      }
      const created = nextVariants.filter((v) => 'isNew' in v);
      if (created.length > 0) {
        await Inventory.insertMany(
          created.map((v) => {
            const src = input.variants.find((x) => x.sku === v.sku)!;
            return {
              sku: v.sku,
              productId: product._id,
              variantId: v._id,
              available: src.initialStock ?? 0,
              lowStockThreshold: src.lowStockThreshold ?? settings.defaultLowStockThreshold,
            };
          }),
          { session },
        );
        await InventoryMovement.insertMany(
          created.map((v) => ({
            sku: v.sku,
            productId: product._id,
            type: 'initial',
            delta: { available: input.variants.find((x) => x.sku === v.sku)!.initialStock ?? 0 },
            actorId: actor.id,
            reason: 'New variant',
          })),
          { session },
        );
      }
      for (const v of input.variants) {
        if (v.id && v.lowStockThreshold !== undefined) {
          await Inventory.updateOne({ sku: v.sku }, { $set: { lowStockThreshold: v.lowStockThreshold } }, { session });
        }
      }

      const previousMedia = product.images.map((i) => i.mediaId.toString());
      const images = await resolveImages(input.images, product._id, session);
      const keptMedia = new Set(images.map((i) => i.mediaId.toString()));
      const detached = previousMedia.filter((m) => !keptMedia.has(m));
      if (detached.length) await Media.updateMany({ _id: { $in: detached } }, { $unset: { attachedTo: 1 } }, { session });

      const categoryPath = await resolveCategory(input.categoryId, session);
      const slug = input.slug && input.slug !== product.slug ? input.slug : product.slug;
      product.set({
        name: input.name,
        slug,
        description: input.description,
        brand: input.brand,
        tags: input.tags,
        searchTokens: searchTokens(input.name, input.brand),
        categoryId: input.categoryId,
        categoryPath,
        images,
        options: input.options,
        variants: nextVariants.map(({ isNew: _n, ...v }) => v),
        status: input.status,
        isFeatured: input.isFeatured,
        hsnCode: input.hsnCode,
        gstRate: input.gstRate,
      });
      if (input.status === 'active' && !product.publishedAt) product.publishedAt = new Date();
      await product.save({ session });
    });
  } catch (err) {
    skuConflict(err);
  }
  await recomputeProductAggregates([id]);
  await audit(actor, 'product.update', 'product', id, input.name);
  return { id };
}

export async function deleteProduct(actor: Actor, id: string) {
  const product = await Product.findById(id);
  if (!product) throw notFound('Product not found.');
  if (product.everOrdered) {
    throw conflict('VALIDATION_ERROR', 'This product appears in orders, so it cannot be deleted. Archive it instead.');
  }
  await withTransaction(async (session) => {
    await Inventory.deleteMany({ productId: product._id }, { session });
    await Media.updateMany({ attachedTo: product._id }, { $unset: { attachedTo: 1 } }, { session });
    await Product.deleteOne({ _id: product._id }, { session });
  });
  await audit(actor, 'product.delete', 'product', id, product.name);
}

export function describeVariant(optionValues: Record<string, string>) {
  return variantLabel(optionValues);
}
