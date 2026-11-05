import { Types } from 'mongoose';
import type {
  AdminCoupon,
  AdminCustomerRow,
  AdminRefundRow,
  AuditLogRow,
  CouponInput,
  DashboardData,
  InventoryMovementRow,
  InventoryRow,
  OrderStatus,
  SalesReportRow,
} from '@shop/shared';
import { isDuplicateKeyError, withTransaction } from '../config/db';
import { Inventory, InventoryMovement, Product } from '../models/catalog.model';
import { Coupon, CouponRedemption, Order, Payment, Refund } from '../models/order.model';
import { AuditLog } from '../models/system.model';
import { Address, User } from '../models/user.model';
import { escapeRegex } from '../utils/crypto';
import { AppError, conflict, forbidden, notFound } from '../utils/errors';
import { pageMeta, skipFor } from '../utils/pagination';
import { variantLabel } from '../utils/text';
import { toAddressDTO } from './account.service';
import { audit, type Actor } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { recomputeProductAggregates } from './catalog.service';
import { toAdminOrderRow, toOrderSummary } from './order.helpers';
import { handleBlockedCustomer } from './order.service';

const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

// ---------------------------------------------------------------- inventory

export async function listInventory(query: { page: number; limit: number; q?: string; lowStock?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (query.lowStock) filter.isLowStock = true;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    const products = await Product.find({ name: rx }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ sku: rx }, { productId: { $in: products.map((p) => p._id) } }];
  }
  const [items, total] = await Promise.all([
    Inventory.find(filter).sort({ isLowStock: -1, available: 1, sku: 1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Inventory.countDocuments(filter),
  ]);
  const products = await Product.find({ _id: { $in: items.map((i) => i.productId) } }, { name: 1, variants: 1 }).lean();
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  const rows: InventoryRow[] = items.map((i) => {
    const p = byId.get(i.productId.toString());
    const v = p?.variants.find((x) => x.sku === i.sku);
    return {
      sku: i.sku,
      productId: i.productId.toString(),
      productName: p?.name ?? '—',
      variantLabel: variantLabel(v?.optionValues as Record<string, string> | undefined),
      available: i.available,
      reserved: i.reserved,
      allocated: i.allocated,
      onHand: i.available + i.reserved + i.allocated,
      lowStockThreshold: i.lowStockThreshold,
      isLowStock: i.isLowStock,
    };
  });
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function adjustInventory(actor: Actor, sku: string, input: { type: 'restock' | 'adjustment'; delta: number; reason: string }) {
  if (input.type === 'restock' && input.delta < 0) throw new AppError(400, 'VALIDATION_ERROR', 'A restock must add stock.');
  const inv = await withTransaction(async (session) => {
    const res = await Inventory.findOneAndUpdate(
      { sku, ...(input.delta < 0 ? { available: { $gte: -input.delta } } : {}) },
      { $inc: { available: input.delta } },
      { session, new: true },
    );
    if (!res) {
      const exists = await Inventory.exists({ sku }).session(session);
      if (!exists) throw notFound('SKU not found.');
      throw conflict('OUT_OF_STOCK', 'Available stock cannot go below zero.');
    }
    await InventoryMovement.create(
      [{ sku, productId: res.productId, type: input.type, delta: { available: input.delta, reserved: 0, allocated: 0 }, actorId: actor.id, reason: input.reason }],
      { session },
    );
    return res;
  });
  await recomputeProductAggregates([inv.productId]);
  await audit(actor, `inventory.${input.type}`, 'inventory', sku, `${input.delta > 0 ? '+' : ''}${input.delta}: ${input.reason}`);
  return { sku, available: inv.available };
}

export async function setLowStockThreshold(actor: Actor, sku: string, lowStockThreshold: number) {
  const inv = await Inventory.findOneAndUpdate({ sku }, { $set: { lowStockThreshold } }, { new: true });
  if (!inv) throw notFound('SKU not found.');
  await recomputeProductAggregates([inv.productId]);
  await audit(actor, 'inventory.threshold', 'inventory', sku, String(lowStockThreshold));
}

export async function listMovements(sku: string, page: number, limit = 20) {
  const [items, total] = await Promise.all([
    InventoryMovement.find({ sku }).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    InventoryMovement.countDocuments({ sku }),
  ]);
  const [orders, actors] = await Promise.all([
    Order.find({ _id: { $in: items.map((m) => m.orderId).filter(Boolean) } }, { orderNumber: 1 }).lean(),
    User.find({ _id: { $in: items.map((m) => m.actorId).filter(Boolean) } }, { name: 1 }).lean(),
  ]);
  const orderNo = new Map(orders.map((o) => [o._id.toString(), o.orderNumber]));
  const actorName = new Map(actors.map((a) => [a._id.toString(), a.name]));
  const rows: InventoryMovementRow[] = items.map((m) => ({
    id: m._id.toString(),
    type: m.type,
    delta: { available: m.delta?.available ?? 0, reserved: m.delta?.reserved ?? 0, allocated: m.delta?.allocated ?? 0 },
    orderNumber: m.orderId ? (orderNo.get(m.orderId.toString()) ?? null) : null,
    reason: m.reason ?? null,
    actorName: m.actorId ? (actorName.get(m.actorId.toString()) ?? null) : m.orderId ? 'System' : null,
    createdAt: m.createdAt.toISOString(),
  }));
  return { items: rows, meta: pageMeta(page, limit, total) };
}

// ---------------------------------------------------------------- customers

export async function listCustomers(query: { page: number; limit: number; q?: string }) {
  const filter: Record<string, unknown> = { role: 'customer' };
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    User.countDocuments(filter),
  ]);
  const stats = await Order.aggregate<{ _id: Types.ObjectId; orders: number; spend: number }>([
    { $match: { userId: { $in: users.map((u) => u._id) }, confirmedAt: { $type: 'date' } } },
    {
      $group: {
        _id: '$userId',
        orders: { $sum: 1 },
        spend: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'undelivered']] }, 0, '$pricing.total'] } },
      },
    },
  ]);
  const byUser = new Map(stats.map((s) => [s._id.toString(), s]));
  const rows: AdminCustomerRow[] = users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    status: u.status as 'active' | 'blocked',
    orderCount: byUser.get(u._id.toString())?.orders ?? 0,
    lifetimeSpend: byUser.get(u._id.toString())?.spend ?? 0,
    createdAt: u.createdAt.toISOString(),
  }));
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function getCustomer(id: string) {
  const user = await User.findOne({ _id: id, role: 'customer' });
  if (!user) throw notFound('Customer not found.');
  const [addresses, orders] = await Promise.all([
    Address.find({ userId: user._id }),
    Order.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    status: user.status,
    createdAt: (user.get('createdAt') as Date).toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    addresses: addresses.map(toAddressDTO),
    recentOrders: orders.map((o) => toOrderSummary(o as never)),
  };
}

export async function setCustomerStatus(actor: Actor, id: string, status: 'active' | 'blocked') {
  if (String(actor.id) === id) throw forbidden('You cannot change your own account status.');
  const user = await User.findById(id);
  if (!user) throw notFound('Customer not found.');
  if (user.role !== 'customer') throw forbidden('Only customer accounts can be blocked here.');
  user.status = status;
  await user.save();
  if (status === 'blocked') {
    await revokeAllSessions(id);
    await handleBlockedCustomer(actor, id);
  }
  await audit(actor, `customer.${status === 'blocked' ? 'block' : 'unblock'}`, 'user', id, user.email);
}

// ---------------------------------------------------------------- coupons

function couponState(c: { isActive: boolean; startsAt: Date; endsAt: Date }): AdminCoupon['state'] {
  const now = new Date();
  if (!c.isActive) return 'inactive';
  if (c.endsAt < now) return 'expired';
  if (c.startsAt > now) return 'scheduled';
  return 'active';
}

function toAdminCoupon(c: InstanceType<typeof Coupon> | (Record<string, unknown> & { _id: Types.ObjectId })): AdminCoupon {
  const x = c as unknown as {
    _id: Types.ObjectId; __v?: number; code: string; description: string; type: 'percentage' | 'fixed'; value: number;
    maxDiscount?: number | null; minOrderValue: number; startsAt: Date; endsAt: Date; usageLimit?: number | null;
    perUserLimit: number; usedCount: number; isActive: boolean;
  };
  return {
    id: x._id.toString(),
    version: x.__v ?? 0,
    code: x.code,
    description: x.description,
    type: x.type,
    value: x.value,
    maxDiscount: x.maxDiscount ?? null,
    minOrderValue: x.minOrderValue,
    startsAt: x.startsAt.toISOString(),
    endsAt: x.endsAt.toISOString(),
    usageLimit: x.usageLimit ?? null,
    perUserLimit: x.perUserLimit,
    usedCount: x.usedCount,
    isActive: x.isActive,
    state: couponState(x),
  };
}

export async function listCoupons(query: { page: number; limit: number; q?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.q) filter.code = new RegExp(escapeRegex(query.q.toUpperCase()));
  const [items, total] = await Promise.all([
    Coupon.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Coupon.countDocuments(filter),
  ]);
  return { items: items.map((c) => toAdminCoupon(c as never)), meta: pageMeta(query.page, query.limit, total) };
}

export async function createCoupon(actor: Actor, input: CouponInput) {
  try {
    const c = await Coupon.create({ ...input, createdBy: actor.id });
    await audit(actor, 'coupon.create', 'coupon', c.id as string, c.code);
    return toAdminCoupon(c);
  } catch (err) {
    if (isDuplicateKeyError(err, 'code')) throw conflict('DUPLICATE', 'A coupon with this code already exists.');
    throw err;
  }
}

export async function updateCoupon(actor: Actor, id: string, input: CouponInput & { version: number }) {
  const c = await Coupon.findById(id);
  if (!c) throw notFound('Coupon not found.');
  if ((c.__v ?? 0) !== input.version) throw conflict('STALE_VERSION', 'This coupon was changed by someone else. Reload and try again.');
  if (c.usedCount > 0 && (input.code !== c.code || input.type !== c.type || input.value !== c.value)) {
    throw conflict('VALIDATION_ERROR', 'Code, type and value cannot change after a coupon has been used.');
  }
  const { version: _v, ...rest } = input;
  c.set(rest);
  try {
    await c.save();
  } catch (err) {
    if (isDuplicateKeyError(err, 'code')) throw conflict('DUPLICATE', 'A coupon with this code already exists.');
    throw err;
  }
  await audit(actor, 'coupon.update', 'coupon', id, c.code);
  return toAdminCoupon(c);
}

export async function deleteCoupon(actor: Actor, id: string) {
  const used = await CouponRedemption.exists({ couponId: id });
  if (used) throw conflict('VALIDATION_ERROR', 'This coupon has been used, so it cannot be deleted. Deactivate it instead.');
  const res = await Coupon.findByIdAndDelete(id);
  if (!res) throw notFound('Coupon not found.');
  await audit(actor, 'coupon.delete', 'coupon', id, res.code);
}

export async function couponRedemptions(id: string, page: number, limit = 20) {
  const [items, total] = await Promise.all([
    CouponRedemption.find({ couponId: id }).sort({ createdAt: -1 }).skip(skipFor(page, limit)).limit(limit).lean(),
    CouponRedemption.countDocuments({ couponId: id }),
  ]);
  const orders = await Order.find({ _id: { $in: items.map((r) => r.orderId) } }, { orderNumber: 1, customer: 1 }).lean();
  const byId = new Map(orders.map((o) => [o._id.toString(), o]));
  return {
    items: items.map((r) => ({
      orderNumber: byId.get(r.orderId.toString())?.orderNumber ?? '—',
      customerEmail: byId.get(r.orderId.toString())?.customer?.email ?? '',
      discount: r.discount,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    meta: pageMeta(page, limit, total),
  };
}

// ---------------------------------------------------------------- analytics

function istStartOfDay(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

function istDateKey(d: Date) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function rangeFor(range: 'today' | '7d' | '30d' | '90d') {
  const now = new Date();
  const days = range === 'today' ? 1 : Number(range.replace('d', ''));
  const from = new Date(istStartOfDay(now).getTime() - (days - 1) * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  return { from, to: now, prevFrom, prevTo: from, days };
}

async function salesTotals(from: Date, to: Date) {
  const [gross] = await Order.aggregate<{ total: number; count: number }>([
    { $match: { confirmedAt: { $gte: from, $lt: to } } },
    { $group: { _id: null, total: { $sum: '$pricing.total' }, count: { $sum: 1 } } },
  ]);
  const [captured] = await Payment.aggregate<{ total: number }>([
    { $match: { capturedAt: { $gte: from, $lt: to }, disposition: 'applied' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const [refunded] = await Refund.aggregate<{ total: number }>([
    { $match: { processedAt: { $gte: from, $lt: to }, reason: { $in: ['order_cancelled', 'undelivered', 'manual'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const customers = await User.countDocuments({ role: 'customer', createdAt: { $gte: from, $lt: to } });
  const grossSales = gross?.total ?? 0;
  const orders = gross?.count ?? 0;
  return {
    grossSales,
    orders,
    netRevenue: (captured?.total ?? 0) - (refunded?.total ?? 0),
    averageOrderValue: orders ? Math.round(grossSales / orders) : 0,
    newCustomers: customers,
  };
}

export async function dashboard(range: 'today' | '7d' | '30d' | '90d'): Promise<DashboardData> {
  const r = rangeFor(range);
  const [cur, prev, series, byStatus, top, latest, awaiting, lowStock, failedRefunds, pendingRefunds, needsReview] = await Promise.all([
    salesTotals(r.from, r.to),
    salesTotals(r.prevFrom, r.prevTo),
    Order.aggregate<{ _id: string; gross: number; orders: number }>([
      { $match: { confirmedAt: { $gte: r.from, $lt: r.to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$confirmedAt', timezone: TZ } }, gross: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: OrderStatus; count: number }>([
      { $match: { createdAt: { $gte: r.from, $lt: r.to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: Types.ObjectId; name: string; units: number; revenue: number }>([
      { $match: { confirmedAt: { $gte: r.from, $lt: r.to }, status: { $nin: ['cancelled', 'undelivered'] } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', name: { $first: '$items.name' }, units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.find({}).sort({ createdAt: -1 }).limit(8).lean(),
    Order.countDocuments({ status: { $in: ['confirmed', 'processing'] } }),
    Inventory.countDocuments({ isLowStock: true }),
    Refund.countDocuments({ status: 'failed' }),
    Refund.countDocuments({ status: { $in: ['requested', 'initiated'] } }),
    Order.countDocuments({ 'needsReview.at': { $type: 'date' } }),
  ]);
  const seriesMap = new Map(series.map((s) => [s._id, s]));
  const points: DashboardData['series'] = [];
  for (let i = 0; i < r.days; i++) {
    const key = istDateKey(new Date(r.from.getTime() + i * 86_400_000));
    const s = seriesMap.get(key);
    points.push({ date: key, grossSales: s?.gross ?? 0, orders: s?.orders ?? 0 });
  }
  const pair = (k: keyof typeof cur) => ({ value: cur[k], previous: prev[k] });
  return {
    range: { from: r.from.toISOString(), to: r.to.toISOString() },
    kpis: {
      grossSales: pair('grossSales'),
      netRevenue: pair('netRevenue'),
      orders: pair('orders'),
      averageOrderValue: pair('averageOrderValue'),
      newCustomers: pair('newCustomers'),
    },
    awaitingFulfilment: awaiting,
    lowStockCount: lowStock,
    series: points,
    ordersByStatus: byStatus.map((s) => ({ status: s._id, count: s.count })).sort((a, b) => b.count - a.count),
    topProducts: top.map((t) => ({ productId: t._id.toString(), name: t.name, units: t.units, revenue: t.revenue })),
    latestOrders: latest.map((o) => toAdminOrderRow(o as never)),
    attention: { failedRefunds, pendingRefunds, needsReview, lowStock },
  };
}

export async function salesReport(fromInput: Date, toInput: Date): Promise<SalesReportRow[]> {
  const from = istStartOfDay(fromInput);
  const to = new Date(istStartOfDay(toInput).getTime() + 86_400_000);
  const days = Math.min(366, Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)));
  const day = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ } });
  const [orders, captures, refunds] = await Promise.all([
    Order.aggregate<{ _id: string; orders: number; gross: number; discounts: number; shipping: number; online: number; cod: number }>([
      { $match: { confirmedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: day('$confirmedAt'),
          orders: { $sum: 1 },
          gross: { $sum: '$pricing.total' },
          discounts: { $sum: '$pricing.discount' },
          shipping: { $sum: '$pricing.shippingFee' },
          online: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'online'] }, 1, 0] } },
          cod: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cod'] }, 1, 0] } },
        },
      },
    ]),
    Payment.aggregate<{ _id: string; total: number }>([
      { $match: { capturedAt: { $gte: from, $lt: to }, disposition: 'applied' } },
      { $group: { _id: day('$capturedAt'), total: { $sum: '$amount' } } },
    ]),
    Refund.aggregate<{ _id: string; total: number }>([
      { $match: { processedAt: { $gte: from, $lt: to }, reason: { $in: ['order_cancelled', 'undelivered', 'manual'] } } },
      { $group: { _id: day('$processedAt'), total: { $sum: '$amount' } } },
    ]),
  ]);
  const o = new Map(orders.map((x) => [x._id, x]));
  const c = new Map(captures.map((x) => [x._id, x.total]));
  const rf = new Map(refunds.map((x) => [x._id, x.total]));
  const rows: SalesReportRow[] = [];
  for (let i = 0; i < days; i++) {
    const key = istDateKey(new Date(from.getTime() + i * 86_400_000));
    const x = o.get(key);
    const refundsTotal = rf.get(key) ?? 0;
    rows.push({
      date: key,
      orders: x?.orders ?? 0,
      grossSales: x?.gross ?? 0,
      discounts: x?.discounts ?? 0,
      shipping: x?.shipping ?? 0,
      refunds: refundsTotal,
      netRevenue: (c.get(key) ?? 0) - refundsTotal,
      averageOrderValue: x?.orders ? Math.round(x.gross / x.orders) : 0,
      onlineOrders: x?.online ?? 0,
      codOrders: x?.cod ?? 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- refunds & audit

export async function listRefunds(query: { page: number; limit: number; status?: string }) {
  const filter = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    Refund.find(filter).sort({ requestedAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Refund.countDocuments(filter),
  ]);
  const orders = await Order.find({ _id: { $in: items.map((r) => r.orderId) } }, { orderNumber: 1 }).lean();
  const byId = new Map(orders.map((o) => [o._id.toString(), o.orderNumber]));
  const rows: AdminRefundRow[] = items.map((r) => ({
    id: r._id.toString(),
    orderNumber: byId.get(r.orderId.toString()) ?? '—',
    amount: r.amount,
    reason: r.reason,
    status: r.status as AdminRefundRow['status'],
    attempts: r.attempts,
    lastError: r.lastError ?? null,
    requestedAt: r.requestedAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  }));
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function listAuditLogs(query: { page: number; limit: number; q?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.q) filter.$or = [{ action: new RegExp(escapeRegex(query.q), 'i') }, { entityId: query.q }];
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const actors = await User.find({ _id: { $in: items.map((a) => a.actorId) } }, { name: 1 }).lean();
  const names = new Map(actors.map((a) => [a._id.toString(), a.name]));
  const rows: AuditLogRow[] = items.map((a) => ({
    id: a._id.toString(),
    actorName: names.get(a.actorId.toString()) ?? 'Unknown',
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
  }));
  return { items: rows, meta: pageMeta(query.page, query.limit, total) };
}

export async function adminListOrders(query: {
  page: number; limit: number; q?: string; status?: string; paymentMethod?: string; userId?: string; needsReview?: boolean;
}) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
  if (query.userId) filter.userId = new Types.ObjectId(query.userId);
  if (query.needsReview) filter['needsReview.at'] = { $type: 'date' };
  if (query.q) {
    const q = query.q.trim();
    filter.$or = [{ orderNumber: q.toUpperCase() }, { 'customer.email': q.toLowerCase() }, { 'customer.name': new RegExp(escapeRegex(q), 'i') }];
  }
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { items: items.map((o) => toAdminOrderRow(o as never)), meta: pageMeta(query.page, query.limit, total) };
}
