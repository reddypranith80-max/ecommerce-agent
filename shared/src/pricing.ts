import type { CouponType } from './enums';

/** Razorpay-style minimum chargeable amount: ₹1. */
export const MIN_CHARGE = 100;

export interface PricingLineInput {
  key: string;
  unitPrice: number;
  quantity: number;
}

export interface PricingCoupon {
  type: CouponType;
  value: number;
  maxDiscount?: number | null;
  minOrderValue: number;
}

export interface PricingSettings {
  shippingFlatFee: number;
  freeShippingThreshold: number;
}

export interface PricedLine {
  key: string;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  discountShare: number;
  lineTotal: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  discount: number;
  couponApplied: boolean;
  couponRejection: 'min_order_value' | null;
  shippingFee: number;
  total: number;
}

/**
 * The one pricing routine used by the cart, the checkout quote and order placement.
 * Order of operations: subtotal → coupon (on subtotal, capped so at least ₹1 remains) →
 * allocate discount to lines → shipping on the discounted item total → total.
 */
export function priceOrder(
  inputLines: PricingLineInput[],
  coupon: PricingCoupon | null,
  settings: PricingSettings,
): PricingResult {
  const lines = inputLines.map((l) => {
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new Error(`Invalid unit price for ${l.key}`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error(`Invalid quantity for ${l.key}`);
    return { ...l, lineSubtotal: l.unitPrice * l.quantity, discountShare: 0, lineTotal: l.unitPrice * l.quantity };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineSubtotal, 0);

  let discount = 0;
  let couponApplied = false;
  let couponRejection: PricingResult['couponRejection'] = null;
  if (coupon) {
    if (subtotal < coupon.minOrderValue) {
      couponRejection = 'min_order_value';
    } else {
      const raw =
        coupon.type === 'percentage'
          ? Math.floor((subtotal * coupon.value) / 100)
          : coupon.value;
      const capped = coupon.type === 'percentage' && coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw;
      discount = Math.max(0, Math.min(capped, subtotal - MIN_CHARGE));
      couponApplied = true;
    }
  }

  allocateDiscount(lines, discount);

  const itemsTotal = subtotal - discount;
  const shippingFee =
    lines.length === 0 || itemsTotal >= settings.freeShippingThreshold ? 0 : settings.shippingFlatFee;

  return {
    lines,
    subtotal,
    discount,
    couponApplied,
    couponRejection,
    shippingFee,
    total: itemsTotal + shippingFee,
  };
}

/** Proportional allocation (floored), remainder to the largest line. Mutates lines. */
function allocateDiscount(lines: PricedLine[], discount: number): void {
  if (discount <= 0 || lines.length === 0) return;
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);
  let allocated = 0;
  for (const line of lines) {
    line.discountShare = Math.floor((discount * line.lineSubtotal) / subtotal);
    allocated += line.discountShare;
  }
  const largest = lines.reduce((a, b) => (b.lineSubtotal > a.lineSubtotal ? b : a));
  largest.discountShare += discount - allocated;
  for (const line of lines) line.lineTotal = line.lineSubtotal - line.discountShare;
}
