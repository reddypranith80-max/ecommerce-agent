import { Types, type ClientSession } from 'mongoose';
import {
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  MAX_WISHLIST,
  type Cart as CartDTO,
  type CartLine,
  type CartLineIssue,
  type ProductCard,
} from '@shop/shared';
import { mediaUrl } from '../integrations/storage';
import { Inventory, Product, type ProductLean } from '../models/catalog.model';
import { Cart, WishlistItem } from '../models/shopping.model';
import { notFound, unprocessable } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { variantLabel } from '../utils/text';
import { toCard } from './catalog.service';

export interface RawCartItem {
  id?: string;
  productId: string;
  variantId: string;
  quantity: number;
  unitPriceAtAdd?: number;
}

export interface HydratedLine extends CartLine {
  product: ProductLean | null;
}

/** Re-prices cart lines from the database and flags anything that would block checkout. */
export async function hydrateLines(items: RawCartItem[], session?: ClientSession): Promise<HydratedLine[]> {
  if (items.length === 0) return [];
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await Product.find({ _id: { $in: productIds } }).session(session ?? null).lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p as unknown as ProductLean]));
  const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
  const inventory = await Inventory.find({ sku: { $in: skus } }).session(session ?? null).lean();
  const stock = new Map(inventory.map((i) => [i.sku, i.available]));

  return items.map((item, index) => {
    const product = byId.get(item.productId) ?? null;
    const variant = product?.variants.find((v) => v._id.toString() === item.variantId);
    const issues: CartLineIssue[] = [];
    let available = 0;
    if (!product || !variant || product.status !== 'active' || !variant.isActive) {
      issues.push('unavailable');
    } else {
      available = stock.get(variant.sku) ?? 0;
      if (available === 0) issues.push('out_of_stock');
      else if (available < item.quantity) issues.push('insufficient_stock');
    }
    const unitPrice = variant?.price ?? item.unitPriceAtAdd ?? 0;
    const priceChanged = item.unitPriceAtAdd !== undefined && variant !== undefined && item.unitPriceAtAdd !== variant.price;
    return {
      id: item.id ?? `guest-${index}`,
      productId: item.productId,
      variantId: item.variantId,
      sku: variant?.sku ?? '',
      slug: product?.slug ?? '',
      name: product?.name ?? 'Unavailable product',
      variantLabel: variantLabel(variant?.optionValues as Record<string, string> | undefined),
      imageUrl: product?.images[0] ? mediaUrl(product.images[0].thumbKey) : null,
      unitPrice,
      previousUnitPrice: priceChanged ? item.unitPriceAtAdd! : null,
      compareAtPrice: variant?.compareAtPrice ?? null,
      quantity: item.quantity,
      lineTotal: unitPrice * item.quantity,
      available: Math.min(available, MAX_QTY_PER_LINE),
      issues,
      warnings: priceChanged ? ['price_changed'] : [],
      product,
    };
  });
}

function toCartDTO(lines: HydratedLine[]): CartDTO {
  const items = lines.map(({ product: _p, ...line }) => line);
  const priced = items.filter((l) => !l.issues.includes('unavailable'));
  return {
    items,
    subtotal: priced.reduce((s, l) => s + l.lineTotal, 0),
    itemCount: items.reduce((s, l) => s + l.quantity, 0),
  };
}

async function loadCart(userId: string) {
  return (await Cart.findOne({ userId })) ?? new Cart({ userId, items: [] });
}

function rawItems(cart: InstanceType<typeof Cart>): RawCartItem[] {
  return cart.items.map((i) => ({
    id: i._id.toString(),
    productId: i.productId.toString(),
    variantId: i.variantId.toString(),
    quantity: i.quantity,
    unitPriceAtAdd: i.unitPriceAtAdd,
  }));
}

export async function getCart(userId: string): Promise<CartDTO> {
  const cart = await loadCart(userId);
  return toCartDTO(await hydrateLines(rawItems(cart)));
}

export async function previewCart(items: RawCartItem[]): Promise<CartDTO> {
  const merged = mergeDuplicates(items);
  return toCartDTO(await hydrateLines(merged));
}

function mergeDuplicates(items: RawCartItem[]): RawCartItem[] {
  const map = new Map<string, RawCartItem>();
  for (const item of items) {
    const key = `${item.productId}:${item.variantId}`;
    const existing = map.get(key);
    if (existing) existing.quantity = Math.min(MAX_QTY_PER_LINE, existing.quantity + item.quantity);
    else map.set(key, { ...item });
  }
  return [...map.values()];
}

async function findSellableVariant(productId: string, variantId: string) {
  const product = await Product.findOne({ _id: productId, status: 'active' }).lean();
  const variant = product?.variants.find((v) => v._id.toString() === variantId && v.isActive);
  if (!product || !variant) throw notFound('This product is not available.');
  return { product, variant };
}

export async function addItem(userId: string, input: { productId: string; variantId: string; quantity: number }) {
  const { variant } = await findSellableVariant(input.productId, input.variantId);
  const cart = await loadCart(userId);
  const existing = cart.items.find((i) => i.variantId.toString() === input.variantId);
  if (existing) {
    existing.quantity = Math.min(MAX_QTY_PER_LINE, existing.quantity + input.quantity);
    existing.unitPriceAtAdd = variant.price;
  } else {
    if (cart.items.length >= MAX_CART_LINES) throw unprocessable('LIMIT_REACHED', `Your cart can hold up to ${MAX_CART_LINES} different items.`);
    cart.items.push({
      productId: new Types.ObjectId(input.productId),
      variantId: new Types.ObjectId(input.variantId),
      sku: variant.sku,
      quantity: input.quantity,
      unitPriceAtAdd: variant.price,
    });
  }
  await cart.save();
  return getCart(userId);
}

export async function updateItem(userId: string, itemId: string, quantity: number) {
  const cart = await loadCart(userId);
  const item = cart.items.id(itemId);
  if (!item) throw notFound('That item is no longer in your cart.');
  item.quantity = quantity;
  await cart.save();
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string) {
  const cart = await loadCart(userId);
  const item = cart.items.id(itemId);
  if (item) {
    item.deleteOne();
    await cart.save();
  }
  return getCart(userId);
}

export async function clearCart(userId: string) {
  await Cart.updateOne({ userId }, { $set: { items: [] } });
  return getCart(userId);
}

export async function mergeGuestCart(userId: string, items: RawCartItem[]) {
  const cart = await loadCart(userId);
  const notMerged: { productId: string; variantId: string; reason: string }[] = [];
  const lines = await hydrateLines(mergeDuplicates(items));
  for (const line of lines) {
    if (line.issues.includes('unavailable')) {
      notMerged.push({ productId: line.productId, variantId: line.variantId, reason: 'unavailable' });
      continue;
    }
    const existing = cart.items.find((i) => i.variantId.toString() === line.variantId);
    if (existing) {
      existing.quantity = Math.min(MAX_QTY_PER_LINE, Math.max(existing.quantity, line.quantity));
    } else if (cart.items.length < MAX_CART_LINES) {
      cart.items.push({
        productId: new Types.ObjectId(line.productId),
        variantId: new Types.ObjectId(line.variantId),
        sku: line.sku,
        quantity: line.quantity,
        unitPriceAtAdd: line.unitPrice,
      });
    } else {
      notMerged.push({ productId: line.productId, variantId: line.variantId, reason: 'cart_full' });
    }
  }
  await cart.save();
  return { cart: await getCart(userId), notMerged };
}

/** Marks current prices as seen (called when the customer views a checkout quote). */
export async function acknowledgePrices(userId: string, lines: HydratedLine[]) {
  const updates = lines.filter((l) => l.warnings.includes('price_changed'));
  if (updates.length === 0) return;
  const cart = await Cart.findOne({ userId });
  if (!cart) return;
  for (const line of updates) {
    const item = cart.items.id(line.id);
    if (item) item.unitPriceAtAdd = line.unitPrice;
  }
  await cart.save();
}

/** Removes purchased quantities once an order is confirmed. Runs inside the confirming transaction. */
export async function removePurchasedFromCart(
  userId: Types.ObjectId | string,
  purchased: { variantId: Types.ObjectId | string; quantity: number }[],
  session: ClientSession,
) {
  const cart = await Cart.findOne({ userId }).session(session);
  if (!cart) return;
  for (const p of purchased) {
    const item = cart.items.find((i) => i.variantId.toString() === p.variantId.toString());
    if (!item) continue;
    if (item.quantity <= p.quantity) item.deleteOne();
    else item.quantity -= p.quantity;
  }
  await cart.save({ session });
}

// ---------------------------------------------------------------- wishlist

export async function listWishlist(userId: string, page: number, limit = 24): Promise<{ items: ProductCard[]; meta: ReturnType<typeof pageMeta> }> {
  const [entries, total] = await Promise.all([
    WishlistItem.find({ userId }).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    WishlistItem.countDocuments({ userId }),
  ]);
  const products = await Product.find({ _id: { $in: entries.map((e) => e.productId) } }).lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const items = entries
    .map((e) => byId.get(e.productId.toString()))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => toCard(p as Parameters<typeof toCard>[0]));
  return { items, meta: pageMeta(page, limit, total) };
}

export async function wishlistIds(userId: string): Promise<string[]> {
  const entries = await WishlistItem.find({ userId }, { productId: 1 }).lean();
  return entries.map((e) => e.productId.toString());
}

export async function addToWishlist(userId: string, productId: string) {
  const exists = await Product.exists({ _id: productId, status: 'active' });
  if (!exists) throw notFound('Product not found.');
  const count = await WishlistItem.countDocuments({ userId });
  if (count >= MAX_WISHLIST) throw unprocessable('LIMIT_REACHED', `Your wishlist can hold up to ${MAX_WISHLIST} products.`);
  await WishlistItem.updateOne({ userId, productId }, { $setOnInsert: { userId, productId } }, { upsert: true });
}

export async function removeFromWishlist(userId: string, productId: string) {
  await WishlistItem.deleteOne({ userId, productId });
}
