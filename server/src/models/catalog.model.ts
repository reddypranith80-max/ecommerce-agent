import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PRODUCT_STATUSES, STOCK_STATUSES } from '@shop/shared';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    imageKey: { type: String },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    ancestors: { type: [Schema.Types.ObjectId], default: [] },
    depth: { type: Number, default: 0, min: 0, max: 2 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);
categorySchema.index({ parentId: 1, sortOrder: 1 });
categorySchema.index({ ancestors: 1 });
export type CategoryDoc = HydratedDocument<InferSchemaType<typeof categorySchema>>;
export const Category = model('Category', categorySchema);

const variantSchema = new Schema({
  sku: { type: String, required: true },
  optionValues: { type: Schema.Types.Mixed, default: {} },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
});

const imageSchema = new Schema(
  {
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true },
    key: { type: String, required: true },
    thumbKey: { type: String, required: true },
    alt: { type: String, default: '' },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    brand: { type: String },
    tags: { type: [String], default: [] },
    searchTokens: { type: [String], default: [] },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryPath: { type: [Schema.Types.ObjectId], default: [] },
    images: { type: [imageSchema], default: [] },
    options: { type: [{ _id: false, name: String, values: [String] }], default: [] },
    variants: { type: [variantSchema], default: [] },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    isFeatured: { type: Boolean, default: false },
    everOrdered: { type: Boolean, default: false },
    hsnCode: { type: String },
    gstRate: { type: Number },
    // Aggregates: written only by recomputeProductAggregates()
    priceMin: { type: Number, default: 0 },
    priceMax: { type: Number, default: 0 },
    compareAtPrice: { type: Number, default: null },
    maxDiscountPct: { type: Number, default: 0 },
    stockStatus: { type: String, enum: STOCK_STATUSES, default: 'out_of_stock' },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    publishedAt: { type: Date },
  },
  { timestamps: true, optimisticConcurrency: true },
);
productSchema.index({ 'variants.sku': 1 }, { unique: true });
productSchema.index(
  { name: 'text', brand: 'text', tags: 'text', description: 'text' },
  { weights: { name: 10, brand: 5, tags: 5, description: 1 }, name: 'product_text' },
);
productSchema.index({ searchTokens: 1 });
productSchema.index({ status: 1, publishedAt: -1 });
productSchema.index({ status: 1, soldCount: -1 });
productSchema.index({ status: 1, ratingAvg: -1 });
productSchema.index({ status: 1, priceMin: 1 });
productSchema.index({ status: 1, maxDiscountPct: -1 });
productSchema.index({ status: 1, isFeatured: 1, publishedAt: -1 });
productSchema.index({ status: 1, categoryPath: 1, publishedAt: -1 });
productSchema.index({ status: 1, categoryPath: 1, soldCount: -1 });
productSchema.index({ status: 1, categoryPath: 1, priceMin: 1 });
productSchema.index({ status: 1, categoryPath: 1, ratingAvg: -1 });

export type ProductDoc = HydratedDocument<InferSchemaType<typeof productSchema>>;
export type ProductLean = InferSchemaType<typeof productSchema> & { _id: import('mongoose').Types.ObjectId };
export const Product = model('Product', productSchema);

const inventorySchema = new Schema(
  {
    sku: { type: String, required: true, unique: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    available: { type: Number, required: true, default: 0, min: 0 },
    reserved: { type: Number, required: true, default: 0, min: 0 },
    allocated: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    isLowStock: { type: Boolean, default: false },
  },
  { timestamps: true },
);
inventorySchema.index({ isLowStock: 1, available: 1 });
export const Inventory = model('Inventory', inventorySchema);

export const MOVEMENT_TYPES = [
  'initial',
  'restock',
  'adjustment',
  'reserve',
  'release',
  'allocate',
  'allocate_direct',
  'deallocate',
  'ship',
  'return_restock',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

const movementSchema = new Schema(
  {
    sku: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    delta: {
      available: { type: Number, default: 0 },
      reserved: { type: Number, default: 0 },
      allocated: { type: Number, default: 0 },
    },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.index({ sku: 1, createdAt: -1 });
movementSchema.index({ orderId: 1 });
export const InventoryMovement = model('InventoryMovement', movementSchema);

const mediaSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    thumbKey: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    attachedTo: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);
mediaSchema.index({ attachedTo: 1, createdAt: 1 });
export const Media = model('Media', mediaSchema);
