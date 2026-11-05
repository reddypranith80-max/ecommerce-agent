import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { GatewayOrder, GatewayPayment } from './gateway.model';
import { simulator } from './simulator';

/**
 * The store's client for the DemoPay gateway. It mirrors the shape of a real gateway SDK
 * (Razorpay: orders.create, payments.fetch, orders.fetchPayments, payments.refund, …).
 * Everything the store knows about payments comes through these calls, never from the browser.
 */

export interface GatewayPaymentInfo {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  method: string;
  errorCode: string | null;
  errorDescription: string | null;
  amountRefunded: number;
}

export interface GatewayRefundInfo {
  id: string;
  paymentId: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  notes: Record<string, string>;
}

export function gatewayId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

function toPaymentInfo(p: InstanceType<typeof GatewayPayment>): GatewayPaymentInfo {
  return {
    id: String(p._id),
    orderId: p.orderId,
    amount: p.amount,
    currency: p.currency,
    status: p.status as GatewayPaymentInfo['status'],
    method: p.method,
    errorCode: p.errorCode ?? null,
    errorDescription: p.errorDescription ?? null,
    amountRefunded: p.amountRefunded ?? 0,
  };
}

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const demoPay = {
  keyId: env.DEMOPAY_KEY_ID,

  async createOrder(input: { amount: number; currency: 'INR'; receipt: string; notes: Record<string, string> }) {
    if (simulator.failNextOrderCreate) {
      simulator.failNextOrderCreate = false;
      throw new Error('DemoPay is unreachable (simulated outage)');
    }
    const order = await GatewayOrder.create({ _id: gatewayId('order'), ...input });
    return { id: String(order._id), amount: order.amount, currency: order.currency, status: order.status };
  },

  async fetchPayment(paymentId: string): Promise<GatewayPaymentInfo | null> {
    const p = await GatewayPayment.findById(paymentId);
    return p ? toPaymentInfo(p) : null;
  },

  async fetchOrderPayments(orderId: string): Promise<GatewayPaymentInfo[]> {
    const list = await GatewayPayment.find({ orderId }).sort({ createdAt: 1 });
    return list.map(toPaymentInfo);
  },

  async createRefund(paymentId: string, input: { amount: number; notes: Record<string, string> }): Promise<GatewayRefundInfo> {
    return simulator.createRefund(paymentId, input);
  },

  async fetchRefunds(paymentId: string): Promise<GatewayRefundInfo[]> {
    const p = await GatewayPayment.findById(paymentId);
    if (!p) return [];
    return p.refunds.map((r) => ({
      id: r._id as string,
      paymentId,
      amount: r.amount,
      status: r.status as GatewayRefundInfo['status'],
      notes: (r.notes ?? {}) as Record<string, string>,
    }));
  },

  /** Checkout signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret), as in Razorpay. */
  checkoutSignature(orderId: string, paymentId: string): string {
    return hmacHex(env.DEMOPAY_KEY_SECRET, `${orderId}|${paymentId}`);
  },

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(this.checkoutSignature(orderId, paymentId), signature);
  },

  webhookSignature(rawBody: Buffer | string): string {
    return hmacHex(env.DEMOPAY_WEBHOOK_SECRET, typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  },

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return safeEqualHex(this.webhookSignature(rawBody), signature);
  },
};
