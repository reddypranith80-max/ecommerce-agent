import { z } from 'zod';
import {
  adminInventoryQuerySchema,
  adminListQuery,
  adminOrderQuerySchema,
  adminProductQuerySchema,
  cancelOrderSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  couponInputSchema,
  couponUpdateSchema,
  customerStatusSchema,
  dashboardQuerySchema,
  inventoryAdjustSchema,
  inventoryThresholdSchema,
  objectId,
  orderStatusUpdateSchema,
  productInputSchema,
  productUpdateSchema,
  REFUND_STATUSES,
  REVIEW_STATUSES,
  reportQuerySchema,
  reviewModerationSchema,
  reviewResolutionSchema,
  settingsUpdateSchema,
} from '@shop/shared';
import { simulator } from '../integrations/demopay/simulator';
import { actorOf } from '../middleware/auth';
import { handle } from '../middleware/handle';
import * as catalogAdmin from '../services/adminCatalog.service';
import * as ops from '../services/adminOps.service';
import { getCategoryTree } from '../services/catalog.service';
import { toAdminOrder } from '../services/order.helpers';
import * as orders from '../services/order.service';
import { retryRefund } from '../services/payment.service';
import * as reviews from '../services/review.service';
import { getSettings, toStoreSettings, updateSettings } from '../services/settings.service';
import { Order } from '../models/order.model';
import { AppError, notFound } from '../utils/errors';
import { toCsv } from '../utils/csv';

const idParams = z.object({ id: objectId });
const skuParams = z.object({ sku: z.string().min(2).max(40) });
const orderParams = z.object({ orderNumber: z.string().regex(/^ORD-\d{6}-[0-9A-Z]{6}$/) });
const listQuery = z.object(adminListQuery).strict();
const pageOnly = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }).strict();

const paged = <T>(res: import('express').Response, result: { items: T[]; meta: unknown }) => {
  res.json({ data: result.items, meta: result.meta });
};

// ---------------------------------------------------------------- dashboard & reports
export const dashboard = handle({ query: dashboardQuerySchema }, async ({ query }) => ops.dashboard(query.range));

export const salesReport = handle({ query: reportQuerySchema }, async ({ res, query }) => {
  if (query.to < query.from) throw new AppError(400, 'VALIDATION_ERROR', '"To" must be on or after "from".');
  const rows = await ops.salesReport(query.from, query.to);
  if (query.format === 'csv') {
    const rupees = (p: number) => (p / 100).toFixed(2);
    const csv = toCsv(
      ['Date', 'Orders', 'Gross sales (INR)', 'Discounts (INR)', 'Shipping (INR)', 'Refunds (INR)', 'Net revenue (INR)', 'Average order value (INR)', 'Online orders', 'COD orders'],
      rows.map((r) => [r.date, r.orders, rupees(r.grossSales), rupees(r.discounts), rupees(r.shipping), rupees(r.refunds), rupees(r.netRevenue), rupees(r.averageOrderValue), r.onlineOrders, r.codOrders]),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-${rows[0]?.date ?? 'report'}-to-${rows.at(-1)?.date ?? ''}.csv"`);
    res.send(csv);
    return;
  }
  return rows;
});

// ---------------------------------------------------------------- catalog
export const categories = handle({}, async () => getCategoryTree(true));
export const createCategory = handle({ body: categoryInputSchema }, async ({ req, body }) => catalogAdmin.createCategory(actorOf(req), body), { status: 201 });
export const updateCategory = handle({ params: idParams, body: categoryUpdateSchema }, async ({ req, params, body }) =>
  catalogAdmin.updateCategory(actorOf(req), params.id, body),
);
export const deleteCategory = handle({ params: idParams }, async ({ req, params }) => {
  await catalogAdmin.deleteCategory(actorOf(req), params.id);
});

export const products = handle({ query: adminProductQuerySchema }, async ({ res, query }) => paged(res, await catalogAdmin.adminListProducts(query)));
export const product = handle({ params: idParams }, async ({ params }) => catalogAdmin.adminGetProduct(params.id));
export const createProduct = handle({ body: productInputSchema }, async ({ req, body }) => catalogAdmin.createProduct(actorOf(req), body), { status: 201 });
export const updateProduct = handle({ params: idParams, body: productUpdateSchema }, async ({ req, params, body }) =>
  catalogAdmin.updateProduct(actorOf(req), params.id, body),
);
export const deleteProduct = handle({ params: idParams }, async ({ req, params }) => {
  await catalogAdmin.deleteProduct(actorOf(req), params.id);
});
export const uploadMedia = handle({}, async ({ req }) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Choose at least one image.');
  return catalogAdmin.uploadMedia(actorOf(req), files);
}, { status: 201 });

// ---------------------------------------------------------------- inventory
export const inventory = handle({ query: adminInventoryQuerySchema }, async ({ res, query }) => paged(res, await ops.listInventory(query)));
export const adjustInventory = handle({ params: skuParams, body: inventoryAdjustSchema }, async ({ req, params, body }) =>
  ops.adjustInventory(actorOf(req), params.sku, body),
);
export const setThreshold = handle({ params: skuParams, body: inventoryThresholdSchema }, async ({ req, params, body }) => {
  await ops.setLowStockThreshold(actorOf(req), params.sku, body.lowStockThreshold);
});
export const movements = handle({ params: skuParams, query: pageOnly }, async ({ res, params, query }) => paged(res, await ops.listMovements(params.sku, query.page)));

// ---------------------------------------------------------------- orders & refunds
export const orderList = handle({ query: adminOrderQuerySchema }, async ({ res, query }) => paged(res, await ops.adminListOrders(query)));
export const orderDetail = handle({ params: orderParams }, async ({ params }) => {
  const [order, settings] = await Promise.all([Order.findOne({ orderNumber: params.orderNumber }).lean(), getSettings()]);
  if (!order) throw notFound('Order not found.');
  return toAdminOrder(order as never, settings.paymentWindowMinutes);
});
export const orderStatus = handle({ params: orderParams, body: orderStatusUpdateSchema }, async ({ req, params, body }) => {
  await orders.updateOrderStatus(actorOf(req), params.orderNumber, body);
  return { ok: true };
});
export const cancelOrder = handle({ params: orderParams, body: cancelOrderSchema }, async ({ req, params, body }) => {
  await orders.cancelOrder(actorOf(req), params.orderNumber, body.reason);
  return { ok: true };
});
export const resolveReview = handle({ params: orderParams, body: reviewResolutionSchema }, async ({ req, params, body }) => {
  await orders.resolveReview(actorOf(req), params.orderNumber, body);
  return { ok: true };
});
export const refunds = handle(
  { query: z.object({ ...adminListQuery, status: z.enum(REFUND_STATUSES).optional() }).strict() },
  async ({ res, query }) => paged(res, await ops.listRefunds(query)),
);
export const retryRefundHandler = handle({ params: idParams }, async ({ params }) => {
  await retryRefund(params.id);
  return { ok: true };
});

// ---------------------------------------------------------------- customers
export const customers = handle({ query: listQuery }, async ({ res, query }) => paged(res, await ops.listCustomers(query)));
export const customer = handle({ params: idParams }, async ({ params }) => ops.getCustomer(params.id));
export const customerStatus = handle({ params: idParams, body: customerStatusSchema }, async ({ req, params, body }) => {
  await ops.setCustomerStatus(actorOf(req), params.id, body.status);
  return { ok: true };
});

// ---------------------------------------------------------------- coupons
export const coupons = handle({ query: listQuery }, async ({ res, query }) => paged(res, await ops.listCoupons(query)));
export const createCoupon = handle({ body: couponInputSchema }, async ({ req, body }) => ops.createCoupon(actorOf(req), body), { status: 201 });
export const updateCoupon = handle({ params: idParams, body: couponUpdateSchema }, async ({ req, params, body }) =>
  ops.updateCoupon(actorOf(req), params.id, body),
);
export const deleteCoupon = handle({ params: idParams }, async ({ req, params }) => {
  await ops.deleteCoupon(actorOf(req), params.id);
});
export const couponRedemptions = handle({ params: idParams, query: pageOnly }, async ({ res, params, query }) =>
  paged(res, await ops.couponRedemptions(params.id, query.page)),
);

// ---------------------------------------------------------------- reviews
export const reviewList = handle(
  { query: z.object({ ...adminListQuery, status: z.enum(REVIEW_STATUSES).optional() }).strict() },
  async ({ res, query }) => paged(res, await reviews.adminListReviews(query)),
);
export const moderateReview = handle({ params: idParams, body: reviewModerationSchema }, async ({ req, params, body }) => {
  await reviews.moderateReview(actorOf(req), params.id, body.status);
  return { ok: true };
});
export const deleteReview = handle({ params: idParams }, async ({ req, params }) => {
  await reviews.adminDeleteReview(actorOf(req), params.id);
});

// ---------------------------------------------------------------- settings, audit, demo tools
export const settings = handle({}, async () => toStoreSettings(await getSettings()));
export const saveSettings = handle({ body: settingsUpdateSchema }, async ({ req, body }) => updateSettings(actorOf(req), body));
export const auditLogs = handle({ query: listQuery }, async ({ res, query }) => paged(res, await ops.listAuditLogs(query)));
export const simulateGatewayOutage = handle({}, async () => {
  simulator.failNextOrderCreate = true;
  return { ok: true, message: 'The next online order will not reach DemoPay, so you can show the "retry payment" flow.' };
});
