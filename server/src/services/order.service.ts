import { Types, type ClientSession } from 'mongoose';
import {
  canTransition,
  priceOrder,
  type CouponRejection,
  type OrderStatusUpdateInput,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type Quote,
} from '@shop/shared';
import { isDuplicateKeyError, withTransaction } from '../config/db';
import { logger } from '../config/logger';
import { Inventory, InventoryMovement, Product } from '../models/catalog.model';
import { Coupon, CouponRedemption, Order, Payment, type CouponDoc, type OrderDoc } from '../models/order.model';
import { Cart } from '../models/shopping.model';
import { Address, type UserDoc } from '../models/user.model';
import { generateOrderNumber, sha256 } from '../utils/crypto';
import { AppError, conflict, notFound, unprocessable } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { audit, SYSTEM_ACTOR, type Actor } from './audit.service';
import { acknowledgePrices, hydrateLines, removePurchasedFromCart, type HydratedLine } from './cart.service';
import { recomputeProductAggregates } from './catalog.service';
import {
  loadOrderDTO,
  moveStock,
  orderEmails,
  pushStatus,
  releaseCouponWithin,
  requestRefundWithin,
  toOrderSummary,
} from './order.helpers';
import { ensureGatewayOrder, kickRefunds } from './payment.service';
import { getSettings } from './settings.service';

type Settings = Awaited<ReturnType<typeof getSettings>>;

const OPEN_COD_STATUSES = ['confirmed', 'processing', 'shipped'];
const RECONCILE_WINDOW_MS = 72 * 3600 * 1000;

function afterCommit(task: () => Promise<unknown>) {
  void task().catch((err) => logger.error({ err }, 'post-commit task failed'));
}

async function cartLines(userId: string, session?: ClientSession) {
  const cart = await Cart.findOne({ userId }).session(session ?? null);
  const raw = (cart?.items ?? []).map((i) => ({
    id: i._id.toString(),
    productId: i.productId.toString(),
    variantId: i.variantId.toString(),
    quantity: i.quantity,
    unitPriceAtAdd: i.unitPriceAtAdd,
  }));
  return hydrateLines(raw, session);
}

// ---------------------------------------------------------------- coupons

async function checkCoupon(
  code: string,
  userId: string,
  session?: ClientSession,
): Promise<{ coupon: CouponDoc; rejection: null } | { coupon: null; rejection: CouponRejection }> {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() }).session(session ?? null);
  const now = new Date();
  if (!coupon) return { coupon: null, rejection: 'not_found' };
  if (!coupon.isActive) return { coupon: null, rejection: 'inactive' };
  if (coupon.startsAt > now) return { coupon: null, rejection: 'not_started' };
  if (coupon.endsAt < now) return { coupon: null, rejection: 'expired' };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { coupon: null, rejection: 'usage_limit_reached' };
  const used = await CouponRedemption.countDocuments({ couponId: coupon._id, userId, status: 'active' }).session(session ?? null);
  if (used >= coupon.perUserLimit) return { coupon: null, rejection: 'per_user_limit_reached' };
  return { coupon, rejection: null };
}

const COUPON_MESSAGES: Record<CouponRejection, string> = {
  not_found: 'That coupon code does not exist.',
  inactive: 'That coupon is no longer active.',
  not_started: 'That coupon is not valid yet.',
  expired: 'That coupon has expired.',
  min_order_value: 'Your order is below the minimum value for this coupon.',
  usage_limit_reached: 'That coupon has been fully used.',
  per_user_limit_reached: 'You have already used this coupon.',
};

function couponError(reason: CouponRejection) {
  return unprocessable('COUPON_INVALID', COUPON_MESSAGES[reason], { reason });
}

async function codEligibility(userId: string, total: number, settings: Settings, session?: ClientSession): Promise<Quote['cod']> {
  if (!settings.codEnabled) return { available: false, reason: 'disabled' };
  if (total > settings.codMaxOrderValue) return { available: false, reason: 'over_limit' };
  const open = await Order.countDocuments({ userId, paymentMethod: 'cod', status: { $in: OPEN_COD_STATUSES } }).session(session ?? null);
  if (open >= settings.codMaxOpenOrders) return { available: false, reason: 'open_orders_limit' };
  return { available: true, reason: null };
}

function priceLines(lines: HydratedLine[], coupon: CouponDoc | null, settings: Settings) {
  const sellable = lines.filter((l) => !l.issues.includes('unavailable'));
  return priceOrder(
    sellable.map((l) => ({ key: l.id, unitPrice: l.unitPrice, quantity: l.quantity })),
    coupon ? { type: coupon.type as 'percentage' | 'fixed', value: coupon.value, maxDiscount: coupon.maxDiscount, minOrderValue: coupon.minOrderValue } : null,
    settings,
  );
}

// ---------------------------------------------------------------- quote

export async function quote(userId: string, input: { couponCode?: string }): Promise<Quote> {
  const [settings, lines] = await Promise.all([getSettings(), cartLines(userId)]);
  let coupon: CouponDoc | null = null;
  let couponErr: Quote['couponError'] = null;
  if (input.couponCode) {
    const check = await checkCoupon(input.couponCode, userId);
    if (check.coupon) coupon = check.coupon;
    else couponErr = { reason: check.rejection };
  }
  const pricing = priceLines(lines, coupon, settings);
  if (coupon && pricing.couponRejection) couponErr = { reason: pricing.couponRejection };
  await acknowledgePrices(userId, lines);
  return {
    lines: lines.map(({ product: _p, ...l }) => l),
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    shippingFee: pricing.shippingFee,
    total: pricing.total,
    coupon: coupon && pricing.couponApplied ? { code: coupon.code, discount: pricing.discount } : null,
    couponError: couponErr,
    cod: await codEligibility(userId, pricing.total, settings),
    issues: lines.flatMap((l) => l.issues.map((issue) => ({ sku: l.sku || l.name, issue }))),
    warnings: lines
      .filter((l) => l.previousUnitPrice !== null)
      .map((l) => ({ sku: l.sku, warning: 'price_changed' as const, previousUnitPrice: l.previousUnitPrice! })),
  };
}

// ---------------------------------------------------------------- place order

async function result(order: OrderDoc, settings: Settings): Promise<PlaceOrderResult> {
  let payment: PlaceOrderResult['payment'] = null;
  let paymentError: PlaceOrderResult['paymentError'] = null;
  if (order.paymentMethod === 'online' && order.status === 'pending_payment') {
    try {
      payment = await ensureGatewayOrder(order);
    } catch (err) {
      logger.error({ err, orderNumber: order.orderNumber }, 'Gateway order creation failed');
      paymentError = { code: 'PAYMENT_PROVIDER_ERROR', message: 'The payment service is not responding. Your order is saved — retry payment in a moment.' };
    }
  }
  return { order: await loadOrderDTO(order, settings.paymentWindowMinutes), payment, paymentError };
}

export async function placeOrder(user: UserDoc, input: PlaceOrderInput, idempotencyKey: string): Promise<PlaceOrderResult> {
  const userId = user.id as string;
  const requestHash = sha256(JSON.stringify([input.addressId, input.paymentMethod, input.couponCode ?? null, input.expectedTotal]));
  const settings = await getSettings();

  const replay = async () => {
    const existing = await Order.findOne({ userId, idempotencyKey });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This checkout was already submitted with different details. Reload the page.');
    }
    return result(existing, settings);
  };
  const previous = await replay();
  if (previous) return previous;

  const address = await Address.findOne({ _id: input.addressId, userId }).lean();
  if (!address) throw notFound('Choose a delivery address.');
  const online = input.paymentMethod === 'online';

  let order: OrderDoc | undefined;
  let replacedOrderIds: Types.ObjectId[] = [];
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    try {
      const out = await withTransaction(async (session) => {
        const lines = await cartLines(userId, session);
        if (lines.length === 0) throw unprocessable('CART_EMPTY', 'Your cart is empty.');
        const problems = lines.filter((l) => l.issues.length > 0);
        if (problems.length > 0) {
          throw conflict('OUT_OF_STOCK', 'Some items in your cart are unavailable or low on stock.', {
            skus: problems.map((l) => l.sku || l.name),
          });
        }

        let coupon: CouponDoc | null = null;
        if (input.couponCode) {
          const check = await checkCoupon(input.couponCode, userId, session);
          if (!check.coupon) throw couponError(check.rejection);
          coupon = check.coupon;
        }
        const pricing = priceLines(lines, coupon, settings);
        if (coupon && pricing.couponRejection) throw couponError(pricing.couponRejection);
        if (pricing.total !== input.expectedTotal) {
          throw conflict('PRICE_CHANGED', 'Prices changed since you reviewed your order. Please check the new total.', {
            total: pricing.total,
          });
        }
        if (!online) {
          const cod = await codEligibility(userId, pricing.total, settings, session);
          if (!cod.available) {
            throw unprocessable('COD_NOT_AVAILABLE', 'Cash on Delivery is not available for this order.', { reason: cod.reason });
          }
        }

        // One open unpaid order per customer: a new online order replaces the previous one.
        const replaced: Types.ObjectId[] = [];
        if (online) {
          const pending = await Order.find({ userId, status: 'pending_payment' }).session(session);
          for (const old of pending) {
            await cancelWithin(session, old, SYSTEM_ACTOR, 'Replaced by a newer order');
            replaced.push(old._id);
          }
        }

        // Take the stock: each update only matches if enough is available, so concurrent orders cannot oversell.
        const failed: string[] = [];
        for (const line of lines) {
          const q = line.quantity;
          const res = await Inventory.updateOne(
            { sku: line.sku, available: { $gte: q } },
            { $inc: online ? { available: -q, reserved: q } : { available: -q, allocated: q } },
            { session },
          );
          if (res.modifiedCount !== 1) failed.push(line.sku);
        }
        if (failed.length > 0) throw conflict('OUT_OF_STOCK', 'Some items just sold out.', { skus: failed });

        const orderId = new Types.ObjectId();
        if (coupon) {
          const res = await Coupon.updateOne(
            { _id: coupon._id, isActive: true, ...(coupon.usageLimit != null ? { usedCount: { $lt: coupon.usageLimit } } : {}) },
            { $inc: { usedCount: 1 } },
            { session },
          );
          if (res.modifiedCount !== 1) throw couponError('usage_limit_reached');
          await CouponRedemption.create([{ couponId: coupon._id, userId, orderId, discount: pricing.discount }], { session });
        }

        const now = new Date();
        const pricedByKey = new Map(pricing.lines.map((l) => [l.key, l]));
        const doc = new Order({
          _id: orderId,
          orderNumber: generateOrderNumber(now),
          userId,
          customer: { name: user.name, email: user.email, phone: address.phone },
          items: lines.map((l) => {
            const priced = pricedByKey.get(l.id)!;
            return {
              productId: l.productId,
              variantId: l.variantId,
              sku: l.sku,
              name: l.name,
              slug: l.slug,
              variantLabel: l.variantLabel,
              imageKey: l.product?.images[0]?.thumbKey,
              unitPrice: l.unitPrice,
              compareAtPrice: l.compareAtPrice,
              quantity: l.quantity,
              lineSubtotal: priced.lineSubtotal,
              discountShare: priced.discountShare,
              lineTotal: priced.lineTotal,
              hsnCode: l.product?.hsnCode,
              gstRate: l.product?.gstRate ?? settings.defaultGstRate,
            };
          }),
          shippingAddress: {
            label: address.label,
            fullName: address.fullName,
            phone: address.phone,
            line1: address.line1,
            line2: address.line2,
            landmark: address.landmark,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: 'IN',
          },
          pricing: {
            subtotal: pricing.subtotal,
            discount: pricing.discount,
            shippingFee: pricing.shippingFee,
            total: pricing.total,
            currency: 'INR',
            taxInclusive: true,
          },
          coupon: coupon ? { couponId: coupon._id, code: coupon.code, discount: pricing.discount } : undefined,
          paymentMethod: input.paymentMethod,
          status: online ? 'pending_payment' : 'confirmed',
          paymentStatus: 'unpaid',
          stockState: online ? 'reserved' : 'allocated',
          statusHistory: [
            {
              status: online ? 'pending_payment' : 'confirmed',
              at: now,
              actorType: 'customer',
              actorId: user._id,
              note: online ? 'Order placed; waiting for payment' : 'Order placed with Cash on Delivery',
            },
          ],
          confirmedAt: online ? undefined : now,
          reservationExpiresAt: online ? new Date(now.getTime() + settings.paymentWindowMinutes * 60_000) : undefined,
          idempotencyKey,
          requestHash,
        });
        await doc.save({ session });
        await InventoryMovement.insertMany(
          lines.map((l) => ({
            sku: l.sku,
            productId: l.productId,
            type: online ? 'reserve' : 'allocate_direct',
            delta: online ? { available: -l.quantity, reserved: l.quantity } : { available: -l.quantity, allocated: l.quantity },
            orderId,
            actorId: user._id,
          })),
          { session },
        );
        await Product.updateMany({ _id: { $in: lines.map((l) => l.productId) } }, { $set: { everOrdered: true } }, { session });
        if (!online) {
          await removePurchasedFromCart(userId, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), session);
        }
        return { doc, replaced };
      });
      order = out.doc;
      replacedOrderIds = out.replaced;
    } catch (err) {
      if (isDuplicateKeyError(err, 'orderNumber')) continue; // astronomically rare; retry with a new number
      if (isDuplicateKeyError(err, 'idempotencyKey')) {
        const again = await replay();
        if (again) return again;
      }
      throw err;
    }
  }
  if (!order) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create the order. Please try again.');

  const placed = order;
  afterCommit(() => recomputeProductAggregates(placed.items.map((i) => i.productId)));
  if (replacedOrderIds.length) logger.info({ replacedOrderIds }, 'Replaced unpaid orders');
  if (!online) afterCommit(() => orderEmails.confirmed(placed));
  return result(placed, settings);
}

// ---------------------------------------------------------------- cancel / expire

/** Cancels inside the caller's transaction; reverses exactly what the order holds. Returns whether a refund was queued. */
async function cancelWithin(session: ClientSession, order: OrderDoc, actor: Actor, reason: string): Promise<boolean> {
  if (!canTransition(order.status as never, 'cancelled', actor.type)) {
    throw conflict('ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled.');
  }
  const now = new Date();
  if (order.stockState === 'reserved') await moveStock(session, order, 'release', actor.id);
  else if (order.stockState === 'allocated') await moveStock(session, order, 'deallocate', actor.id);
  order.stockState = 'released';
  await releaseCouponWithin(session, order._id);
  pushStatus(order, 'cancelled', actor, reason);
  order.cancelledAt = now;
  order.cancellation = { reason, actorType: actor.type, actorId: actor.id ? new Types.ObjectId(String(actor.id)) : undefined };
  order.reservationExpiresAt = undefined;
  if (order.paymentMethod === 'online') order.reconcileUntil = new Date(now.getTime() + RECONCILE_WINDOW_MS);
  let refund = false;
  if (order.paymentStatus === 'paid') refund = await requestRefundWithin(session, order, 'order_cancelled');
  await order.save({ session });
  return refund;
}

export async function cancelOrder(actor: Actor, orderNumber: string, reason: string, scope: { userId?: string } = {}) {
  const { order, refund } = await withTransaction(async (session) => {
    const doc = await Order.findOne({ orderNumber, ...(scope.userId ? { userId: scope.userId } : {}) }).session(session);
    if (!doc) throw notFound('Order not found.');
    const r = await cancelWithin(session, doc, actor, reason);
    return { order: doc, refund: r };
  });
  afterCommit(() => recomputeProductAggregates(order.items.map((i) => i.productId)));
  afterCommit(() => orderEmails.statusChanged(order, refund ? 'Your payment will be refunded in full automatically.' : ''));
  if (refund) kickRefunds();
  if (actor.type === 'admin') await audit(actor, 'order.cancel', 'order', order.orderNumber, reason);
  return order;
}

/** Called by the expiry job once the payment window and grace period have passed with no payment. */
export async function expireOrder(orderId: Types.ObjectId): Promise<boolean> {
  const order = await withTransaction(async (session) => {
    const doc = await Order.findOne({ _id: orderId, status: 'pending_payment' }).session(session);
    if (!doc) return null;
    await moveStock(session, doc, 'release');
    doc.stockState = 'released';
    await releaseCouponWithin(session, doc._id);
    pushStatus(doc, 'expired', SYSTEM_ACTOR, 'Payment window closed without a payment');
    doc.expiredAt = new Date();
    doc.reservationExpiresAt = undefined;
    doc.reconcileUntil = new Date(Date.now() + RECONCILE_WINDOW_MS);
    doc.jobLockedUntil = undefined;
    await doc.save({ session });
    return doc;
  });
  if (!order) return false;
  afterCommit(() => recomputeProductAggregates(order.items.map((i) => i.productId)));
  afterCommit(() => orderEmails.statusChanged(order, 'The items have been released. You can place the order again any time.'));
  return true;
}

// ---------------------------------------------------------------- customer views

export async function listMyOrders(userId: string, query: { page: number; limit: number; status?: string }) {
  const filter = { userId, ...(query.status ? { status: query.status } : {}) };
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { items: items.map((o) => toOrderSummary(o as never)), meta: pageMeta(query.page, query.limit, total) };
}

export async function getMyOrder(userId: string, orderNumber: string) {
  const [order, settings] = await Promise.all([Order.findOne({ orderNumber, userId }).lean(), getSettings()]);
  if (!order) throw notFound('Order not found.');
  return loadOrderDTO(order as never, settings.paymentWindowMinutes);
}

// ---------------------------------------------------------------- admin fulfilment

export async function updateOrderStatus(actor: Actor, orderNumber: string, input: OrderStatusUpdateInput) {
  const order = await withTransaction(async (session) => {
    const doc = await Order.findOne({ orderNumber }).session(session);
    if (!doc) throw notFound('Order not found.');
    if (!canTransition(doc.status as never, input.status, 'admin')) {
      throw conflict('INVALID_STATUS_TRANSITION', `An order that is "${doc.status}" cannot move to "${input.status}".`);
    }
    const now = new Date();
    let refundQueued = false;
    switch (input.status) {
      case 'processing':
        doc.processingAt = now;
        break;
      case 'shipped':
        await moveStock(session, doc, 'ship', actor.id);
        doc.stockState = 'shipped';
        doc.shippedAt = now;
        doc.fulfilment = { carrier: input.carrier, trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl };
        break;
      case 'delivered':
        doc.deliveredAt = now;
        if (doc.paymentMethod === 'cod' && doc.paymentStatus === 'unpaid') {
          doc.paymentStatus = 'paid';
          doc.paidAt = now;
          await Payment.create(
            [{ orderId: doc._id, userId: doc.userId, provider: 'cod', amount: doc.pricing.total, method: 'cash', status: 'captured', capturedAt: now, disposition: 'applied' }],
            { session },
          );
        }
        break;
      case 'undelivered': {
        doc.undeliveredAt = now;
        doc.fulfilment = { ...(doc.fulfilment ?? {}), undeliveredReason: input.undeliveredReason };
        if (input.undeliveredReason === 'lost_in_transit') {
          doc.stockState = 'written_off';
        } else {
          await moveStock(session, doc, 'return_restock', actor.id);
          doc.stockState = 'restocked';
        }
        if (doc.paymentStatus === 'paid' && doc.paymentMethod === 'online') {
          refundQueued = await requestRefundWithin(session, doc, 'undelivered');
        }
        break;
      }
    }
    pushStatus(doc, input.status, actor, input.note);
    await doc.save({ session });
    return Object.assign(doc, { refundQueued });
  });
  if (order.refundQueued) kickRefunds();
  if (input.status === 'undelivered') afterCommit(() => recomputeProductAggregates(order.items.map((i) => i.productId)));
  if (input.status !== 'processing') {
    const extra =
      input.status === 'shipped'
        ? `Carrier: ${input.carrier}\nTracking number: ${input.trackingNumber}${input.trackingUrl ? `\nTrack: ${input.trackingUrl}` : ''}`
        : order.refundQueued
          ? 'Your payment will be refunded in full automatically.'
          : '';
    afterCommit(() => orderEmails.statusChanged(order, extra));
  }
  await audit(actor, `order.${input.status}`, 'order', orderNumber, input.note ?? '');
  return order;
}

export async function resolveReview(actor: Actor, orderNumber: string, input: { resolution: 'keep' | 'cancel'; note?: string }) {
  if (input.resolution === 'cancel') {
    await cancelOrder(actor, orderNumber, input.note || 'Cancelled after review');
  }
  const res = await Order.updateOne({ orderNumber }, { $unset: { needsReview: 1 } });
  if (res.matchedCount === 0) throw notFound('Order not found.');
  await audit(actor, 'order.review_resolved', 'order', orderNumber, input.resolution);
}

/** Blocking a customer: cancel unpaid orders and flag open COD orders for an admin decision. */
export async function handleBlockedCustomer(actor: Actor, userId: string) {
  const pending = await Order.find({ userId, status: 'pending_payment' }, { orderNumber: 1 }).lean();
  for (const o of pending) {
    try {
      await cancelOrder(actor, o.orderNumber, 'Customer account blocked');
    } catch (err) {
      logger.warn({ err, orderNumber: o.orderNumber }, 'Could not cancel pending order of blocked customer');
    }
  }
  await Order.updateMany(
    { userId, paymentMethod: 'cod', status: { $in: OPEN_COD_STATUSES } },
    { $set: { needsReview: { reason: 'Customer was blocked while this COD order was open', at: new Date() } } },
  );
}
