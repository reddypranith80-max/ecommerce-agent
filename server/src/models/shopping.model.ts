import { Schema, model } from 'mongoose';
import { MAX_QTY_PER_LINE, REVIEW_STATUSES } from '@shop/shared';

const cartItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  sku: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, max: MAX_QTY_PER_LINE },
  unitPriceAtAdd: { type: Number, required: true },
  addedAt: { type: Date, default: () => new Date() },
});

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true },
);
export const Cart = model('Cart', cartSchema);

const wishlistSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
wishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });
wishlistSchema.index({ userId: 1, createdAt: -1 });
export const WishlistItem = model('WishlistItem', wishlistSchema);

const reviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: REVIEW_STATUSES, default: 'published' },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
  },
  { timestamps: true },
);
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });
export const Review = model('Review', reviewSchema);
