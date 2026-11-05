import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError, notFound } from '../../utils/errors';
import { gatewayId, demoPay, type GatewayRefundInfo } from './client';
import { GatewayOrder, GatewayPayment } from './gateway.model';

/**
 * The provider side of DemoPay: what Razorpay's servers would do.
 * - The hosted checkout calls `pay()` when the shopper confirms (or fails) a payment.
 * - Webhooks are POSTed to the store, signed with the webhook secret, and retried on failure.
 * - Refunds settle a moment later and are announced by webhook.
 * Virtual money only: nothing here talks to a bank.
 */

export type PayOutcome = 'success' | 'failure' | 'success_close';
export type PayMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

const WEBHOOK_URL = env.DEMOPAY_WEBHOOK_URL ?? `http://127.0.0.1:${env.PORT}/api/v1/webhooks/demopay`;

class DemoPaySimulator {
  /** Tests turn this off and deliver webhooks themselves. */
  webhooksEnabled = true;
  refundDelayMs = 1500;
  /** Lets a demo show what happens when the gateway is down while an order is placed. */
  failNextOrderCreate = false;

  async getCheckout(gatewayOrderId: string) {
    const order = await GatewayOrder.findById(gatewayOrderId);
    if (!order) throw notFound('Payment session not found.');
    return { id: order._id, amount: order.amount, currency: order.currency, status: order.status, receipt: order.receipt };
  }

  async pay(gatewayOrderId: string, method: PayMethod, outcome: PayOutcome) {
    const order = await GatewayOrder.findById(gatewayOrderId);
    if (!order) throw notFound('Payment session not found.');
    if (order.status === 'paid') throw new AppError(409, 'ORDER_ALREADY_PAID', 'This order has already been paid.');

    const paymentId = gatewayId('pay');
    if (outcome === 'failure') {
      await GatewayPayment.create({
        _id: paymentId,
        orderId: order._id,
        amount: order.amount,
        currency: order.currency,
        method,
        status: 'failed',
        errorCode: 'BAD_REQUEST_ERROR',
        errorDescription: 'Payment declined by the (simulated) bank.',
      });
      order.status = 'attempted';
      await order.save();
      this.sendWebhook('payment.failed', { payment: await this.paymentEntity(paymentId) });
      throw new AppError(402, 'PAYMENT_DECLINED', 'Payment declined by the (simulated) bank.', { gatewayPaymentId: paymentId });
    }

    await GatewayPayment.create({
      _id: paymentId,
      orderId: order._id,
      amount: order.amount,
      currency: order.currency,
      method,
      status: 'captured',
    });
    order.status = 'paid';
    await order.save();
    this.sendWebhook('payment.captured', { payment: await this.paymentEntity(paymentId) });

    if (outcome === 'success_close') {
      // The shopper closed the tab before the browser could report success: only the webhook will tell the store.
      return { closed: true as const };
    }
    return {
      closed: false as const,
      gatewayOrderId: String(order._id),
      gatewayPaymentId: paymentId,
      signature: demoPay.checkoutSignature(String(order._id), paymentId),
    };
  }

  async createRefund(paymentId: string, input: { amount: number; notes: Record<string, string> }): Promise<GatewayRefundInfo> {
    const payment = await GatewayPayment.findById(paymentId);
    if (!payment) throw new Error(`DemoPay: payment ${paymentId} not found`);
    if (payment.status === 'failed') throw new Error('DemoPay: cannot refund a failed payment');
    if (payment.amountRefunded + input.amount > payment.amount) throw new Error('DemoPay: refund exceeds captured amount');
    const refundId = gatewayId('rfnd');
    payment.refunds.push({ _id: refundId, amount: input.amount, status: 'pending', notes: input.notes });
    payment.amountRefunded += input.amount;
    payment.status = payment.amountRefunded >= payment.amount ? 'refunded' : 'partially_refunded';
    await payment.save();

    this.track(this.refundDelayMs, () => this.settleRefund(paymentId, refundId));

    return { id: refundId, paymentId, amount: input.amount, status: 'pending', notes: input.notes };
  }

  async settleRefund(paymentId: string, refundId: string) {
    try {
      const payment = await GatewayPayment.findOneAndUpdate(
        { _id: paymentId, 'refunds._id': refundId },
        { $set: { 'refunds.$.status': 'processed' } },
        { new: true },
      );
      if (!payment) return;
      const refund = payment.refunds.find((r) => r._id === refundId);
      this.sendWebhook('refund.processed', {
        refund: { id: refundId, paymentId, amount: refund?.amount ?? 0, status: 'processed', notes: refund?.notes ?? {} },
      });
    } catch (err) {
      logger.error({ err }, 'DemoPay: refund settlement failed');
    }
  }

  private async paymentEntity(paymentId: string) {
    const p = await GatewayPayment.findById(paymentId).lean();
    if (!p) return null;
    return {
      id: p._id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      method: p.method,
      errorCode: p.errorCode ?? null,
      errorDescription: p.errorDescription ?? null,
    };
  }

  /** Retry schedule for webhook delivery (tests shorten it). */
  webhookDelays = [800, 2000, 5000, 10000, 20000];

  /** How a webhook is delivered; returns the HTTP status. Tests replace this to deliver in-process. */
  transport: (body: string, headers: Record<string, string>) => Promise<number> = async (body, headers) => {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', headers, body });
    return res.status;
  };

  private inFlight = new Set<Promise<void>>();

  /** Resolves once every scheduled webhook delivery (including retries) has finished. Used by tests. */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private track(delayMs: number, fn: () => Promise<void>) {
    const p = new Promise<void>((resolve) => {
      const t = setTimeout(() => void fn().finally(resolve), delayMs);
      t.unref?.();
    });
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  /** Signed webhook with exponential-backoff retries, like a real gateway. */
  sendWebhook(event: string, payload: Record<string, unknown>) {
    if (!this.webhooksEnabled) return;
    const eventId = `evt_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const body = JSON.stringify({ event, payload, createdAt: Math.floor(Date.now() / 1000) });
    const headers = {
      'content-type': 'application/json',
      'x-demopay-signature': demoPay.webhookSignature(body),
      'x-demopay-event-id': eventId,
    };
    const delays = this.webhookDelays;

    const attempt = async (n: number): Promise<void> => {
      try {
        const status = await this.transport(body, headers);
        if (status >= 200 && status < 300) return;
        throw new Error(`HTTP ${status}`);
      } catch (err) {
        if (n + 1 < delays.length) {
          logger.warn({ event, eventId, attempt: n + 1, err: (err as Error).message }, 'DemoPay webhook failed; will retry');
          this.track(delays[n + 1]!, () => attempt(n + 1));
        } else {
          logger.error({ event, eventId }, 'DemoPay webhook gave up after retries');
        }
      }
    };
    this.track(delays[0]!, () => attempt(0));
  }
}

export const simulator = new DemoPaySimulator();
