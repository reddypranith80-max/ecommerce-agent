import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { simulator } from '../integrations/demopay/simulator';
import { handle } from '../middleware/handle';
import { EmailMessage } from '../models/system.model';
import { handleWebhook } from '../services/payment.service';
import { notFound } from '../utils/errors';

/**
 * Webhook receiver. Uses the raw body (signature is computed over exact bytes).
 * Returns 5xx when processing fails so the gateway redelivers; the event is recorded in the same
 * transaction as its effect, so a redelivery after a failure is processed rather than skipped.
 */
export const demopayWebhook: RequestHandler = async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const signature = req.header('x-demopay-signature') ?? undefined;
  const eventId = req.header('x-demopay-event-id') ?? undefined;
  const outcome = await handleWebhook(raw, signature, eventId);
  logger.info({ eventId, outcome }, 'Webhook handled');
  res.status(200).json({ data: { outcome } });
};

// ---------------------------------------------------------------- simulated hosted checkout (the "gateway" side)
const gatewayParams = z.object({ gatewayOrderId: z.string().regex(/^order_[A-Za-z0-9_-]{6,40}$/) });

export const checkoutSession = handle({ params: gatewayParams }, async ({ params }) => simulator.getCheckout(params.gatewayOrderId));

export const checkoutPay = handle(
  {
    params: gatewayParams,
    body: z
      .object({ method: z.enum(['upi', 'card', 'netbanking', 'wallet']), outcome: z.enum(['success', 'failure', 'success_close']) })
      .strict(),
  },
  async ({ params, body }) => simulator.pay(params.gatewayOrderId, body.method, body.outcome),
);

// ---------------------------------------------------------------- demo inbox (demo mode only)
export const demoInbox = handle({ query: z.object({ email: z.string().max(254).optional() }).strict() }, async ({ query }) => {
  if (!env.DEMO_MODE) throw notFound();
  const filter = query.email ? { to: query.email.toLowerCase() } : {};
  const mails = await EmailMessage.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  return mails.map((m) => ({ id: m._id.toString(), to: m.to, subject: m.subject, text: m.text, createdAt: m.createdAt.toISOString() }));
});
