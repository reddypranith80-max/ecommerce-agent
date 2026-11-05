import { Schema, model } from 'mongoose';

/*
 * These collections belong to the simulated payment provider ("DemoPay"), not to the store.
 * In a real deployment this data lives at Razorpay; the store only sees it through the API in client.ts.
 */

const gatewayOrderSchema = new Schema(
  {
    _id: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    receipt: { type: String },
    notes: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['created', 'attempted', 'paid'], default: 'created' },
  },
  { timestamps: true, collection: 'demopay_orders' },
);
export const GatewayOrder = model('GatewayOrder', gatewayOrderSchema);

const gatewayRefundSchema = new Schema(
  {
    _id: { type: String },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
    notes: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const gatewayPaymentSchema = new Schema(
  {
    _id: { type: String },
    orderId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    method: { type: String, required: true },
    status: { type: String, enum: ['captured', 'failed', 'refunded', 'partially_refunded'], required: true },
    errorCode: { type: String },
    errorDescription: { type: String },
    amountRefunded: { type: Number, default: 0 },
    refunds: { type: [gatewayRefundSchema], default: [] },
  },
  { timestamps: true, collection: 'demopay_payments' },
);
export const GatewayPayment = model('GatewayPayment', gatewayPaymentSchema);
