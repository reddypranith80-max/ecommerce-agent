import type { ClientSession, Types } from 'mongoose';
import {
  allowedTransitions,
  formatINR,
  isCancellableBy,
  ORDER_STATUS_LABELS,
  type Order as OrderDTO,
  type OrderStatus,
  type OrderSummary,
  type AdminOrder,
  type AdminOrderRow,
  type RefundReason,
} from '@shop/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { sendMail } from '../integrations/mailer';
import { mediaUrl } from '../integrations/storage';
import { Inventory, InventoryMovement, type MovementType } from '../models/catalog.model';
import { Coupon, CouponRedemption, Payment, Refund, type OrderDoc, type OrderLean } from '../models/order.model';
import type { Actor } from './audit.service';

type AnyOrder = OrderDoc | OrderLean;

export function pushStatus(order: OrderDoc, status: OrderStatus, actor: Actor, note?: string) {
  order.status = status;
  order.statusHistory.push({ status, at: new Date(), actorType: actor.type, actorId: actor.id, note });
}

type StockOp = Extract<MovementType, 'release' | 'allocate' | 'deallocate' | 'ship' | 'return_restock'>;

const STOCK_OPS: Record<StockOp, { guard: 'reserved' | 'allocated' | null; inc: (q: number) => Record<string, number> }> = {
  release: { guard: 'reserved', inc: (q) => ({ reserved: -q, available: q }) },
  allocate: { guard: 'reserved', inc: (q) => ({ reserved: -q, allocated: q }) },
  deallocate: { guard: 'allocated', inc: (q) => ({ allocated: -q, available: q }) },
  ship: { guard: 'allocated', inc: (q) => ({ allocated: -q }) },
  return_restock: { guard: null, inc: (q) => ({ available: q }) },
};

/** Applies one stock movement for every line of an order, with a ledger entry per line. */
export async function moveStock(session: ClientSession, order: AnyOrder, op: StockOp, actorId?: Types.ObjectId | string) {
  const spec = STOCK_OPS[op];
  for (const item of order.items) {
    const filter: Record<string, unknown> = { sku: item.sku };
    if (spec.guard) filter[spec.guard] = { $gte: item.quantity };
    const res = await Inventory.updateOne(filter, { $inc: spec.inc(item.quantity) }, { session });
    if (res.modifiedCount !== 1) {
      throw new Error(`Inventory invariant violated: ${op} ${item.quantity} × ${item.sku} on order ${order.orderNumber}`);
    }
  }
  await InventoryMovement.insertMany(
    order.items.map((item) => {
      const inc = spec.inc(item.quantity);
      return {
        sku: item.sku,
        productId: item.productId,
        type: op,
        delta: { available: inc.available ?? 0, reserved: inc.reserved ?? 0, allocated: inc.allocated ?? 0 },
        orderId: order._id,
        actorId,
      };
    }),
    { session },
  );
}

export async function releaseCouponWithin(session: ClientSession, orderId: Types.ObjectId) {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { orderId, status: 'active' },
    { $set: { status: 'released' } },
    { session },
  );
  if (redemption) {
    await Coupon.updateOne({ _id: redemption.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
  }
}

/** Queues a full refund of the payment that paid for this order. Executed later by the refund job. */
export async function requestRefundWithin(session: ClientSession, order: OrderDoc, reason: RefundReason) {
  const payment = await Payment.findOne({ orderId: order._id, disposition: 'applied', provider: 'demopay' }).session(session);
  if (!payment || !payment.gatewayPaymentId) return false;
  const amount = payment.amount - (payment.refundedAmount ?? 0);
  if (amount <= 0) return false;
  await Refund.create(
    [{ orderId: order._id, paymentId: payment._id, gatewayPaymentId: payment.gatewayPaymentId, amount, reason, requestedAt: new Date() }],
    { session },
  );
  order.paymentStatus = 'refund_pending';
  return true;
}

// ---------------------------------------------------------------- serializers

function paymentClosingMarginMs(windowMinutes: number) {
  return Math.min(120_000, windowMinutes * 60_000 * 0.2);
}

export function canStartPayment(order: AnyOrder, windowMinutes: number, now = Date.now()) {
  if (order.status !== 'pending_payment' || order.paymentMethod !== 'online' || !order.reservationExpiresAt) return false;
  return now < order.reservationExpiresAt.getTime() - paymentClosingMarginMs(windowMinutes);
}

export function toOrderDTO(
  order: AnyOrder,
  refunds: { _id: Types.ObjectId; amount: number; reason: string; status: string; requestedAt: Date; processedAt?: Date | null }[],
  windowMinutes: number,
): OrderDTO {
  const a = order.shippingAddress ?? {};
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status as OrderStatus,
    paymentStatus: order.paymentStatus as OrderDTO['paymentStatus'],
    paymentMethod: order.paymentMethod as OrderDTO['paymentMethod'],
    items: order.items.map((i) => ({
      productId: i.productId.toString(),
      variantId: i.variantId.toString(),
      sku: i.sku,
      name: i.name,
      variantLabel: i.variantLabel ?? '',
      imageUrl: mediaUrl(i.imageKey),
      unitPrice: i.unitPrice,
      compareAtPrice: i.compareAtPrice ?? null,
      quantity: i.quantity,
      lineSubtotal: i.lineSubtotal,
      discountShare: i.discountShare ?? 0,
      lineTotal: i.lineTotal,
      slug: i.slug,
    })),
    shippingAddress: {
      label: a.label ?? null,
      fullName: a.fullName ?? '',
      phone: a.phone ?? '',
      line1: a.line1 ?? '',
      line2: a.line2 ?? null,
      landmark: a.landmark ?? null,
      city: a.city ?? '',
      state: (a.state ?? 'Delhi') as OrderDTO['shippingAddress']['state'],
      postalCode: a.postalCode ?? '',
      country: 'IN',
    },
    pricing: {
      subtotal: order.pricing.subtotal,
      discount: order.pricing.discount,
      shippingFee: order.pricing.shippingFee,
      total: order.pricing.total,
      currency: 'INR',
    },
    coupon: order.coupon?.code ? { code: order.coupon.code, discount: order.coupon.discount ?? 0 } : null,
    statusHistory: order.statusHistory.map((e) => ({
      status: e.status as OrderStatus,
      at: e.at.toISOString(),
      actorType: e.actorType as 'customer' | 'admin' | 'system',
      note: e.note ?? null,
    })),
    fulfilment: {
      carrier: order.fulfilment?.carrier ?? null,
      trackingNumber: order.fulfilment?.trackingNumber ?? null,
      trackingUrl: order.fulfilment?.trackingUrl ?? null,
      undeliveredReason: order.fulfilment?.undeliveredReason ?? null,
    },
    windowEndsAt: order.status === 'pending_payment' && order.reservationExpiresAt ? order.reservationExpiresAt.toISOString() : null,
    cancellation: order.cancellation?.reason
      ? { reason: order.cancellation.reason, actorType: (order.cancellation.actorType ?? 'customer') as 'customer' | 'admin' | 'system' }
      : null,
    refunds: refunds.map((r) => ({
      id: r._id.toString(),
      amount: r.amount,
      reason: r.reason,
      status: r.status as OrderDTO['refunds'][number]['status'],
      requestedAt: r.requestedAt.toISOString(),
      processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    })),
    createdAt: (order as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
    canCancel: isCancellableBy(order.status as OrderStatus, 'customer'),
    canPay: canStartPayment(order, windowMinutes),
  };
}

export async function loadOrderDTO(order: AnyOrder, windowMinutes: number): Promise<OrderDTO> {
  const refunds = await Refund.find({ orderId: order._id }).sort({ requestedAt: 1 }).lean();
  return toOrderDTO(order, refunds, windowMinutes);
}

export function toOrderSummary(order: OrderLean): OrderSummary {
  return {
    orderNumber: order.orderNumber,
    status: order.status as OrderSummary['status'],
    paymentStatus: order.paymentStatus as OrderSummary['paymentStatus'],
    paymentMethod: order.paymentMethod as OrderSummary['paymentMethod'],
    total: order.pricing.total,
    itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    firstItemName: order.items[0]?.name ?? '',
    firstItemImageUrl: mediaUrl(order.items[0]?.imageKey),
    createdAt: order.createdAt.toISOString(),
  };
}

export function toAdminOrderRow(order: OrderLean): AdminOrderRow {
  return {
    orderNumber: order.orderNumber,
    customerName: order.customer?.name ?? '',
    customerEmail: order.customer?.email ?? '',
    status: order.status as AdminOrderRow['status'],
    paymentStatus: order.paymentStatus as AdminOrderRow['paymentStatus'],
    paymentMethod: order.paymentMethod as AdminOrderRow['paymentMethod'],
    total: order.pricing.total,
    itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    needsReview: Boolean(order.needsReview?.at),
    createdAt: order.createdAt.toISOString(),
  };
}

export async function toAdminOrder(order: OrderLean, windowMinutes: number): Promise<AdminOrder> {
  const [dto, payments] = await Promise.all([
    loadOrderDTO(order, windowMinutes),
    Payment.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
  ]);
  return {
    ...dto,
    canCancel: isCancellableBy(order.status as OrderStatus, 'admin'),
    customer: {
      id: order.userId.toString(),
      name: order.customer?.name ?? '',
      email: order.customer?.email ?? '',
      phone: order.customer?.phone ?? null,
    },
    payments: payments.map((p) => ({
      id: p._id.toString(),
      provider: p.provider as 'demopay' | 'cod',
      gatewayPaymentId: p.gatewayPaymentId ?? null,
      amount: p.amount,
      method: p.method ?? null,
      status: p.status,
      disposition: p.disposition ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    allowedTransitions: allowedTransitions(order.status as OrderStatus, 'admin').filter((s) => s !== 'cancelled'),
    needsReview: order.needsReview?.at ? { reason: order.needsReview.reason ?? '', at: order.needsReview.at.toISOString() } : null,
    stockState: order.stockState,
  };
}

// ---------------------------------------------------------------- emails (best effort, after commit)

function orderLink(order: AnyOrder) {
  return `${env.APP_ORIGIN}/orders/${order.orderNumber}`;
}

function itemsText(order: AnyOrder) {
  return order.items.map((i) => `  • ${i.quantity} × ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} — ${formatINR(i.lineTotal)}`).join('\n');
}

export const orderEmails = {
  async confirmed(order: AnyOrder) {
    const how = order.paymentMethod === 'cod' ? 'Pay with cash when it arrives.' : 'Payment received (virtual money).';
    await send(order, `Order ${order.orderNumber} confirmed`, `Thanks for your order!\n\n${itemsText(order)}\n\nTotal: ${formatINR(order.pricing.total)}\n${how}\n\nTrack it: ${orderLink(order)}`);
  },
  async statusChanged(order: AnyOrder, extra = '') {
    await send(order, `Order ${order.orderNumber}: ${ORDER_STATUS_LABELS[order.status as OrderStatus]}`, `Your order is now "${ORDER_STATUS_LABELS[order.status as OrderStatus]}".${extra ? `\n\n${extra}` : ''}\n\nDetails: ${orderLink(order)}`);
  },
  async refundProcessed(order: AnyOrder, amount: number) {
    await send(order, `Refund of ${formatINR(amount)} processed`, `We have refunded ${formatINR(amount)} for order ${order.orderNumber} (virtual money).\n\nDetails: ${orderLink(order)}`);
  },
  async paymentWillBeRefunded(order: AnyOrder, amount: number) {
    await send(
      order,
      `We are refunding your payment for ${order.orderNumber}`,
      `A payment of ${formatINR(amount)} reached us after order ${order.orderNumber} was ${ORDER_STATUS_LABELS[order.status as OrderStatus].toLowerCase()}${order.paymentStatus === 'paid' ? ' (it was already paid)' : ''}. It is being refunded in full automatically.\n\nDetails: ${orderLink(order)}`,
    );
  },
};

async function send(order: AnyOrder, subject: string, text: string) {
  const to = order.customer?.email;
  if (!to) return;
  try {
    await sendMail({ to, subject, text: `Hi ${order.customer?.name ?? ''},\n\n${text}` });
  } catch (err) {
    logger.error({ err }, 'Order email failed');
  }
}
