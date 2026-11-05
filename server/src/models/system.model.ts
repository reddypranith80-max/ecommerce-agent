import { Schema, model, type InferSchemaType } from 'mongoose';

const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'store' },
    storeName: { type: String, default: 'Storefront Demo' },
    supportEmail: { type: String, default: 'support@storefront.demo' },
    supportPhone: { type: String, default: '+91 80000 00000' },
    codEnabled: { type: Boolean, default: true },
    codMaxOrderValue: { type: Number, default: 1_000_000 },
    codMaxOpenOrders: { type: Number, default: 2 },
    shippingFlatFee: { type: Number, default: 4900 },
    freeShippingThreshold: { type: Number, default: 99_900 },
    paymentWindowMinutes: { type: Number, default: 15 },
    paymentGraceMinutes: { type: Number, default: 10 },
    defaultLowStockThreshold: { type: Number, default: 5 },
    defaultGstRate: { type: Number, default: 18 },
    heroTitle: { type: String, default: 'Everyday essentials, thoughtfully made' },
    heroSubtitle: {
      type: String,
      default: 'Browse the collection, try a coupon, and check out with virtual money — nothing here is charged for real.',
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);
export type SettingsShape = InferSchemaType<typeof settingsSchema>;
export const Settings = model('Settings', settingsSchema);

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    summary: { type: String, default: '' },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
export const AuditLog = model('AuditLog', auditLogSchema);

/** Demo mode outbox: emails are stored here and shown on the "Demo inbox" page instead of being sent. */
const emailSchema = new Schema(
  {
    to: { type: String, required: true },
    subject: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
emailSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const EmailMessage = model('EmailMessage', emailSchema);
