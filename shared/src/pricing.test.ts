import { describe, expect, it } from 'vitest';
import { allowedTransitions, canTransition } from './orderStates';
import { priceOrder } from './pricing';
import { formatINR } from './money';

const settings = { shippingFlatFee: 4900, freeShippingThreshold: 99900 };

describe('priceOrder', () => {
  it('adds shipping below the free-shipping threshold', () => {
    const r = priceOrder([{ key: 'a', unitPrice: 49900, quantity: 1 }], null, settings);
    expect(r).toMatchObject({ subtotal: 49900, discount: 0, shippingFee: 4900, total: 54800 });
  });

  it('applies percentage coupons with a cap, then evaluates free shipping on the discounted total', () => {
    const r = priceOrder(
      [{ key: 'a', unitPrice: 60000, quantity: 2 }],
      { type: 'percentage', value: 25, maxDiscount: 20000, minOrderValue: 0 },
      settings,
    );
    expect(r.discount).toBe(20000); // 25% of ₹1,200 = ₹300, capped at ₹200
    expect(r.shippingFee).toBe(0); // ₹1,000 after discount ≥ ₹999
    expect(r.total).toBe(100000);
  });

  it('never discounts below ₹1 and rejects coupons under the minimum order value', () => {
    expect(priceOrder([{ key: 'a', unitPrice: 5000, quantity: 1 }], { type: 'fixed', value: 99999, minOrderValue: 0 }, settings).discount).toBe(4900);
    const r = priceOrder([{ key: 'a', unitPrice: 5000, quantity: 1 }], { type: 'fixed', value: 1000, minOrderValue: 10000 }, settings);
    expect(r).toMatchObject({ couponApplied: false, couponRejection: 'min_order_value', discount: 0 });
  });

  it('allocates the discount across lines without losing a paisa', () => {
    const r = priceOrder(
      [
        { key: 'a', unitPrice: 33333, quantity: 1 },
        { key: 'b', unitPrice: 33333, quantity: 1 },
        { key: 'c', unitPrice: 33334, quantity: 1 },
      ],
      { type: 'fixed', value: 1000, minOrderValue: 0 },
      settings,
    );
    expect(r.lines.reduce((s, l) => s + l.discountShare, 0)).toBe(1000);
    expect(r.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(r.subtotal - r.discount);
  });

  it('rejects non-integer money', () => {
    expect(() => priceOrder([{ key: 'a', unitPrice: 10.5, quantity: 1 }], null, settings)).toThrow();
  });
});

describe('order state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending_payment', 'confirmed', 'system')).toBe(true);
    expect(canTransition('pending_payment', 'confirmed', 'customer')).toBe(false);
    expect(canTransition('confirmed', 'cancelled', 'customer')).toBe(true);
    expect(canTransition('processing', 'cancelled', 'customer')).toBe(false);
    expect(canTransition('processing', 'cancelled', 'admin')).toBe(true);
    expect(canTransition('shipped', 'cancelled', 'admin')).toBe(false);
    expect(allowedTransitions('shipped', 'admin').sort()).toEqual(['delivered', 'undelivered']);
    expect(allowedTransitions('delivered', 'admin')).toEqual([]);
  });
});

describe('formatINR', () => {
  it('formats paise in Indian grouping', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(49950)).toBe('₹499.50');
  });
});
