export const ROLES = ['customer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'blocked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const PAYMENT_METHODS = ['online', 'cod'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'expired',
  'undelivered',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAYMENT_STATUSES = [
  'unpaid',
  'paid',
  'refund_pending',
  'partially_refunded',
  'refunded',
  'refund_failed',
] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const STOCK_STATES = ['reserved', 'allocated', 'shipped', 'released', 'restocked', 'written_off'] as const;
export type StockState = (typeof STOCK_STATES)[number];

export const PAYMENT_RECORD_STATUSES = ['created', 'authorized', 'captured', 'failed', 'partially_refunded', 'refunded'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const REFUND_STATUSES = ['requested', 'initiated', 'processed', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_REASONS = ['order_cancelled', 'undelivered', 'late_payment', 'duplicate_payment', 'manual'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const UNDELIVERED_REASONS = ['returned_to_origin', 'refused', 'lost_in_transit'] as const;
export type UndeliveredReason = (typeof UNDELIVERED_REASONS)[number];

export const COUPON_TYPES = ['percentage', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const COUPON_REJECTIONS = [
  'not_found',
  'inactive',
  'not_started',
  'expired',
  'min_order_value',
  'usage_limit_reached',
  'per_user_limit_reached',
] as const;
export type CouponRejection = (typeof COUPON_REJECTIONS)[number];

export const REVIEW_STATUSES = ['published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PRODUCT_SORTS = ['relevance', 'newest', 'popular', 'price_asc', 'price_desc', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const CART_LINE_ISSUES = ['out_of_stock', 'insufficient_stock', 'unavailable'] as const;
export type CartLineIssue = (typeof CART_LINE_ISSUES)[number];

export const MAX_QTY_PER_LINE = 10;
export const MAX_CART_LINES = 50;
export const MAX_ADDRESSES = 10;
export const MAX_WISHLIST = 200;

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
] as const;
export type IndianState = (typeof INDIAN_STATES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  expired: 'Expired',
  undelivered: 'Not delivered',
};

export const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  refund_pending: 'Refund pending',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  refund_failed: 'Refund failed',
};
