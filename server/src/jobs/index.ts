import { logger } from '../config/logger';
import { Order } from '../models/order.model';
import { cleanupOrphanMedia } from '../services/adminCatalog.service';
import { recomputeAllProductAggregates } from '../services/catalog.service';
import { expireOrder } from '../services/order.service';
import { processRefundQueue, reconcileGatewayOrder } from '../services/payment.service';
import { getSettings } from '../services/settings.service';

type Stop = () => void;

/** Runs fn every intervalMs, scheduling the next run only after the current one finishes (never overlaps). */
function every(name: string, intervalMs: number, fn: () => Promise<unknown>, runImmediately = false): Stop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Job failed');
    } finally {
      if (!stopped) timer = setTimeout(run, intervalMs);
    }
  };
  timer = setTimeout(run, runImmediately ? 1000 : intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** Claims a document for this worker for 60 s, so several API instances never process the same order. */
async function claim(orderId: unknown) {
  const now = new Date();
  return Order.findOneAndUpdate(
    { _id: orderId, $or: [{ jobLockedUntil: { $exists: false } }, { jobLockedUntil: null }, { jobLockedUntil: { $lt: now } }] },
    { $set: { jobLockedUntil: new Date(now.getTime() + 60_000) } },
    { new: true },
  );
}

/** Expire unpaid orders after the payment window + grace, but first ask the gateway whether they were paid. */
export async function expireUnpaidOrders(): Promise<number> {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - settings.paymentGraceMinutes * 60_000);
  const due = await Order.find({ status: 'pending_payment', reservationExpiresAt: { $lt: cutoff } }, { _id: 1 }).limit(100).lean();
  let expired = 0;
  for (const { _id } of due) {
    const order = await claim(_id);
    if (!order || order.status !== 'pending_payment') continue;
    if (order.gatewayOrderId) {
      try {
        const paid = await reconcileGatewayOrder(order.gatewayOrderId);
        if (paid) continue;
      } catch (err) {
        // If the gateway cannot be asked, do not expire: we might cancel a paid order.
        logger.warn({ err, orderNumber: order.orderNumber }, 'Could not reconcile with gateway; will retry');
        continue;
      }
    }
    if (await expireOrder(order._id)) {
      expired++;
      logger.info({ orderNumber: order.orderNumber }, 'Unpaid order expired');
    }
  }
  return expired;
}

/** For 72 h after an online order is cancelled or expires, look for captures the store never heard about. */
export async function reconcileClosedOrders(): Promise<void> {
  const orders = await Order.find(
    { reconcileUntil: { $gt: new Date() }, gatewayOrderId: { $type: 'string' } },
    { gatewayOrderId: 1 },
  )
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  for (const o of orders) {
    await reconcileGatewayOrder(o.gatewayOrderId!).catch((err) => logger.warn({ err }, 'reconcile failed'));
  }
}

export function startJobs(): Stop {
  const stops = [
    every('expire-unpaid-orders', 20_000, expireUnpaidOrders),
    every('refund-queue', 5_000, () => processRefundQueue()),
    every('reconcile-closed-orders', 60_000, reconcileClosedOrders),
    every('product-aggregates-repair', 6 * 3600_000, recomputeAllProductAggregates, true),
    every('media-cleanup', 3600_000, () => cleanupOrphanMedia()),
  ];
  logger.info('Background jobs started');
  return () => stops.forEach((s) => s());
}
