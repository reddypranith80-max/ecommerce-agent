import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import {
  COUPON_TYPES,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  STOCK_STATES,
} from '@shop/shared';

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    variantLabel: { type: String, default: '' },
    imageKey: { type: String },
    unitPrice: { type: Number, required: true },
    compareAtPrice: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 1 },
    lineSubtotal: { type: Number, required: true },
    discountShare: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true },
    hsnCode: { type: String },
    gstRate: { type: Number },
  },
  { _id: false },
);

const pricingSchema = new Schema(
  {
    subtotal: { type: Number, required: true },
    discount: { type: Number, required: true },
    shippingFee: { type: Number, required: true },
    total: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    taxInclusive: { type: Boolean, default: true },
  },
  { _id: false },
);

const statusEventSchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
    actorType: { type: String, enum: ['customer', 'admin', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId },
    note: { type: String },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customer: { name: String, email: String, phone: String },
    items: { type: [orderItemSchema], required: true },
    shippingAddress: {
      label: String,
      fullName: String,
      phone: String,
      line1: String,
      line2: String,
      landmark: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    pricing: { type: pricingSchema, required: true },
    coupon: { couponId: Schema.Types.ObjectId, code: String, discount: Number },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    gatewayOrderId: { type: String },
    status: { type: String, enum: ORDER_STATUSES, required: true },
    paymentStatus: { type: String, enum: ORDER_PAYMENT_STATUSES, required: true, default: 'unpaid' },
    stockState: { type: String, enum: STOCK_STATES, required: true },
    statusHistory: { type: [statusEventSchema], default: [] },
    fulfilment: { carrier: String, trackingNumber: String, trackingUrl: String, undeliveredReason: String },
    confirmedAt: Date,
    paidAt: Date,
    processingAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    expiredAt: Date,
    undeliveredAt: Date,
    refundedAt: Date,
    reservationExpiresAt: Date,
    reconcileUntil: Date,
    jobLockedUntil: Date,
    needsReview: { reason: String, at: Date },
    cancellation: { reason: String, actorType: String, actorId: Schema.Types.ObjectId },
    idempotencyKey: { type: String },
    requestHash: { type: String },
  },
  { timestamps: true },
);
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ 'customer.email': 1 });
orderSchema.index({ gatewayOrderId: 1 }, { unique: true, partialFilterExpression: { gatewayOrderId: { $type: 'string' } } });
orderSchema.index({ reservationExpiresAt: 1 }, { partialFilterExpression: { status: 'pending_payment' } });
orderSchema.index({ reconcileUntil: 1 }, { partialFilterExpression: { reconcileUntil: { $type: 'date' } } });
orderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
orderSchema.index({ userId: 1, 'items.productId': 1, status: 1 });
orderSchema.index({ confirmedAt: 1 }, { partialFilterExpression: { confirmedAt: { $type: 'date' } } });
orderSchema.index({ 'needsReview.at': 1 }, { partialFilterExpression: { 'needsReview.at': { $type: 'date' } } });

export type OrderShape = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<OrderShape>;
export type OrderLean = OrderShape & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export const Order = model('Order', orderSchema);

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['demopay', 'cod'], required: true },
    gatewayPaymentId: { type: String },
    gatewayOrderId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    method: { type: String },
    status: { type: String, enum: PAYMENT_RECORD_STATUSES, required: true },
    capturedAt: Date,
    error: { code: String, description: String },
    disposition: { type: String, enum: ['applied', 'refund_required'] },
    refundedAmount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
paymentSchema.index({ gatewayPaymentId: 1 }, { unique: true, partialFilterExpression: { gatewayPaymentId: { $type: 'string' } } });
paymentSchema.index({ capturedAt: 1 }, { partialFilterExpression: { capturedAt: { $type: 'date' } } });
export const Payment = model('Payment', paymentSchema);

const refundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    gatewayPaymentId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, enum: REFUND_REASONS, required: true },
    source: { type: String, enum: ['system', 'admin', 'gateway_dashboard'], default: 'system' },
    status: { type: String, enum: REFUND_STATUSES, required: true, default: 'requested' },
    gatewayRefundId: { type: String },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    requestedAt: { type: Date, required: true },
    initiatedAt: Date,
    processedAt: Date,
    jobLockedUntil: Date,
  },
  { timestamps: true },
);
refundSchema.index({ status: 1, jobLockedUntil: 1 });
refundSchema.index({ gatewayRefundId: 1 }, { unique: true, partialFilterExpression: { gatewayRefundId: { $type: 'string' } } });
refundSchema.index({ processedAt: 1 }, { partialFilterExpression: { processedAt: { $type: 'date' } } });
export const Refund = model('Refund', refundSchema);

const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    outcome: { type: String },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    type: { type: String, enum: COUPON_TYPES, required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscount: { type: Number, default: null },
    minOrderValue: { type: Number, default: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    usageLimit: { type: Number, default: null },
    perUserLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);
couponSchema.index({ isActive: 1, endsAt: 1 });
export type CouponDoc = HydratedDocument<InferSchemaType<typeof couponSchema>>;
export const Coupon = model('Coupon', couponSchema);

const redemptionSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    discount: { type: Number, required: true },
    status: { type: String, enum: ['active', 'released'], default: 'active' },
  },
  { timestamps: true },
);
redemptionSchema.index({ couponId: 1, userId: 1, status: 1 });
redemptionSchema.index({ couponId: 1, createdAt: -1 });
export const CouponRedemption = model('CouponRedemption', redemptionSchema);
