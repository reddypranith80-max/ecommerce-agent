import { z } from 'zod';
import {
  COUPON_TYPES,
  INDIAN_STATES,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
  REVIEW_STATUSES,
  UNDELIVERED_REASONS,
} from './enums';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .refine((s) => new TextEncoder().encode(s).length <= 72, 'Use at most 72 characters.')
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), 'Include at least one letter and one number.');

const name = z.string().trim().min(2, 'Enter at least 2 characters.').max(80);
const indianPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'))
  .transform((s) => (s.startsWith('+91') ? s : `+91${s}`));

// ---------- auth & account ----------
export const registerSchema = z.object({ name, email, password: passwordSchema }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password.').max(200), newPassword: passwordSchema })
  .strict();
export const updateProfileSchema = z
  .object({ name: name.optional(), phone: z.union([indianPhone, z.literal('')]).optional() })
  .strict();

export const addressSchema = z
  .object({
    label: z.string().trim().max(30).optional(),
    fullName: name,
    phone: indianPhone,
    line1: z.string().trim().min(3, 'Enter the street address.').max(120),
    line2: z.string().trim().max(120).optional(),
    landmark: z.string().trim().max(80).optional(),
    city: z.string().trim().min(2, 'Enter the city.').max(60),
    state: z.enum(INDIAN_STATES, { message: 'Choose a state.' }),
    postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code.'),
    isDefault: z.boolean().optional(),
  })
  .strict();
export const addressUpdateSchema = addressSchema.partial().strict();

// ---------- catalog ----------
const boolFromQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
};

export const productListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().max(80).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    rating: z.coerce.number().int().min(1).max(4).optional(),
    inStock: boolFromQuery.optional(),
    sort: z.enum(PRODUCT_SORTS).optional(),
    ...paginationQuery,
    limit: z.coerce.number().int().min(1).max(48).default(24),
  })
  .strict();

export const suggestQuerySchema = z.object({ q: z.string().trim().min(2).max(60) }).strict();
export const productCardsSchema = z.object({ ids: z.array(objectId).max(20) }).strict();

// ---------- cart & wishlist ----------
const quantity = z.number().int().min(1).max(MAX_QTY_PER_LINE);
export const cartItemInputSchema = z.object({ productId: objectId, variantId: objectId, quantity }).strict();
export const cartQuantitySchema = z.object({ quantity }).strict();
export const cartItemsSchema = z.object({ items: z.array(cartItemInputSchema).max(MAX_CART_LINES) }).strict();

// ---------- checkout & orders ----------
const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,20}$/, 'Coupon codes are 3–20 letters, numbers or dashes.');

export const quoteSchema = z
  .object({
    addressId: objectId.optional(),
    couponCode: couponCode.optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict();

export const placeOrderSchema = z
  .object({
    addressId: objectId,
    paymentMethod: z.enum(PAYMENT_METHODS),
    couponCode: couponCode.optional(),
    expectedTotal: z.number().int().min(0),
  })
  .strict();

export const verifyPaymentSchema = z
  .object({
    orderNumber: z.string().max(40),
    gatewayOrderId: z.string().max(60),
    gatewayPaymentId: z.string().max(60),
    signature: z.string().max(200),
  })
  .strict();

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(3, 'Tell us why.').max(300) }).strict();

export const orderListQuerySchema = z
  .object({ status: z.enum(ORDER_STATUSES).optional(), ...paginationQuery, limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

// ---------- reviews ----------
export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().min(3, 'Add a short title.').max(120),
    body: z.string().trim().min(10, 'Write at least 10 characters.').max(2000),
  })
  .strict();
export const reviewUpdateSchema = reviewSchema.partial().strict();
export const reviewListQuerySchema = z
  .object({ sort: z.enum(['newest', 'highest', 'lowest']).default('newest'), ...paginationQuery })
  .strict();

// ---------- admin ----------
export const adminListQuery = {
  q: z.string().trim().max(100).optional(),
  ...paginationQuery,
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes.')
  .max(80);

export const categoryInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    slug: slug.optional(),
    parentId: objectId.nullable().optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const categoryUpdateSchema = categoryInputSchema.partial().extend({ version: z.number().int().min(0) }).strict();

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, 'SKUs use letters, numbers and dashes.');

export const variantInputSchema = z
  .object({
    id: objectId.optional(),
    sku,
    optionValues: z.record(z.string().max(30), z.string().trim().min(1).max(40)),
    price: z.number().int().min(100, 'Price must be at least ₹1.').max(100_000_000),
    compareAtPrice: z.number().int().min(0).max(100_000_000).nullable().optional(),
    isActive: z.boolean().default(true),
    initialStock: z.number().int().min(0).max(100_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice === 0 || v.compareAtPrice > v.price, {
    message: 'Compare-at price must be higher than the price.',
    path: ['compareAtPrice'],
  });

const productBase = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slug.optional(),
    description: z.string().trim().max(5000).default(''),
    brand: z.string().trim().max(60).optional(),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
    categoryId: objectId,
    status: z.enum(PRODUCT_STATUSES).default('draft'),
    isFeatured: z.boolean().default(false),
    options: z
      .array(z.object({ name: z.string().trim().min(1).max(30), values: z.array(z.string().trim().min(1).max(40)).min(1).max(30) }).strict())
      .max(3)
      .default([]),
    variants: z.array(variantInputSchema).min(1, 'Add at least one variant.').max(100),
    images: z
      .array(z.object({ mediaId: objectId, alt: z.string().trim().max(120).default('') }).strict())
      .max(10)
      .default([]),
    hsnCode: z.string().trim().regex(/^\d{4,8}$/, 'HSN codes are 4–8 digits.').optional(),
    gstRate: z.number().min(0).max(28).optional(),
  })
  .strict();

const uniqueSkus = (p: { variants: { sku: string }[] }) => new Set(p.variants.map((v) => v.sku)).size === p.variants.length;

export const productInputSchema = productBase.refine(uniqueSkus, {
  message: 'Each variant needs a different SKU.',
  path: ['variants'],
});
export const productUpdateSchema = productBase
  .extend({ version: z.number().int().min(0) })
  .refine(uniqueSkus, { message: 'Each variant needs a different SKU.', path: ['variants'] });

export const adminProductQuerySchema = z
  .object({
    ...adminListQuery,
    status: z.enum(PRODUCT_STATUSES).optional(),
    category: objectId.optional(),
  })
  .strict();

export const inventoryAdjustSchema = z
  .object({
    type: z.enum(['restock', 'adjustment']),
    delta: z.number().int().refine((n) => n !== 0, 'Enter a non-zero quantity.'),
    reason: z.string().trim().min(3, 'Give a reason.').max(200),
  })
  .strict();
export const inventoryThresholdSchema = z.object({ lowStockThreshold: z.number().int().min(0).max(10_000) }).strict();
export const adminInventoryQuerySchema = z.object({ ...adminListQuery, lowStock: boolFromQuery.optional() }).strict();

export const adminOrderQuerySchema = z
  .object({
    ...adminListQuery,
    status: z.enum(ORDER_STATUSES).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    userId: objectId.optional(),
    needsReview: boolFromQuery.optional(),
  })
  .strict();

export const orderStatusUpdateSchema = z
  .object({
    status: z.enum(['processing', 'shipped', 'delivered', 'undelivered']),
    note: z.string().trim().max(300).optional(),
    carrier: z.string().trim().max(60).optional(),
    trackingNumber: z.string().trim().max(60).optional(),
    trackingUrl: z.string().trim().url().max(300).optional(),
    undeliveredReason: z.enum(UNDELIVERED_REASONS).optional(),
  })
  .strict()
  .refine((v) => v.status !== 'shipped' || (v.carrier && v.trackingNumber), {
    message: 'Carrier and tracking number are required to ship.',
    path: ['trackingNumber'],
  })
  .refine((v) => v.status !== 'undelivered' || v.undeliveredReason, {
    message: 'Choose why the order was not delivered.',
    path: ['undeliveredReason'],
  });

export const reviewResolutionSchema = z
  .object({ resolution: z.enum(['keep', 'cancel']), note: z.string().trim().max(300).optional() })
  .strict();

export const customerStatusSchema = z.object({ status: z.enum(['active', 'blocked']) }).strict();

const couponBase = z
  .object({
    code: couponCode,
    description: z.string().trim().max(200).default(''),
    type: z.enum(COUPON_TYPES),
    value: z.number().int().min(1),
    maxDiscount: z.number().int().min(1).nullable().optional(),
    minOrderValue: z.number().int().min(0).default(0),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    isActive: z.boolean().default(true),
  })
  .strict();
const couponRules = <T extends z.ZodType<{ type: string; value: number; startsAt: Date; endsAt: Date }>>(s: T) =>
  s
    .refine((c) => c.type !== 'percentage' || c.value <= 90, { message: 'Percentage must be 1–90.', path: ['value'] })
    .refine((c) => c.endsAt > c.startsAt, { message: 'End must be after start.', path: ['endsAt'] });
export const couponInputSchema = couponRules(couponBase);
export const couponUpdateSchema = couponRules(couponBase.extend({ version: z.number().int().min(0) }));

export const reviewModerationSchema = z.object({ status: z.enum(REVIEW_STATUSES) }).strict();

export const settingsUpdateSchema = z
  .object({
    version: z.number().int().min(0),
    storeName: z.string().trim().min(2).max(60).optional(),
    supportEmail: z.string().trim().email().optional(),
    supportPhone: z.string().trim().max(20).optional(),
    codEnabled: z.boolean().optional(),
    codMaxOrderValue: z.number().int().min(0).optional(),
    codMaxOpenOrders: z.number().int().min(1).max(20).optional(),
    shippingFlatFee: z.number().int().min(0).optional(),
    freeShippingThreshold: z.number().int().min(0).optional(),
    paymentWindowMinutes: z.number().int().min(1).max(120).optional(),
    paymentGraceMinutes: z.number().int().min(0).max(60).optional(),
    defaultLowStockThreshold: z.number().int().min(0).max(1000).optional(),
    heroTitle: z.string().trim().max(80).optional(),
    heroSubtitle: z.string().trim().max(200).optional(),
  })
  .strict();

export const reportQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

export const dashboardQuerySchema = z.object({ range: z.enum(['today', '7d', '30d', '90d']).default('30d') }).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type CouponInput = z.infer<typeof couponInputSchema>;
export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;
