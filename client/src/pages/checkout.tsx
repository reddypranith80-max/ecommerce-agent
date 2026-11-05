import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, MapPin, Plus, ShieldCheck, Tag, X } from 'lucide-react';
import type { PaymentInit, PlaceOrderResult, Quote } from '@shop/shared';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Input, Modal, Skeleton, cx, useDocumentTitle } from '../components/ui';
import { AddressForm, AddressLines } from '../features/address';
import { keys, useAddresses, useConfig } from '../features/hooks';
import { DemoPayCheckout } from '../features/payment';
import { formatINR, newIdempotencyKey } from '../lib/format';
import { ApiError, api, errorMessage } from '../services/api';
import { toast } from '../store/local';

const COD_REASONS: Record<string, string> = {
  disabled: 'Cash on Delivery is switched off right now.',
  over_limit: 'Cash on Delivery is not available for orders this large.',
  open_orders_limit: 'You already have the maximum number of open Cash on Delivery orders.',
};

export function CheckoutPage() {
  useDocumentTitle('Checkout');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = useConfig();
  const addresses = useAddresses();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [method, setMethod] = useState<'online' | 'cod'>('online');
  const [couponDraft, setCouponDraft] = useState('');
  const [coupon, setCoupon] = useState<string | undefined>();
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pay, setPay] = useState<{ orderNumber: string; payment: PaymentInit } | null>(null);
  // One key per checkout attempt: a double click or a retried request can never create two orders.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0])!.id);
  }, [addresses.data, addressId]);

  const quote = useQuery({
    queryKey: ['quote', coupon],
    queryFn: () => api.post<Quote>('/checkout/quote', coupon ? { couponCode: coupon } : {}),
  });

  useEffect(() => {
    if (quote.data && !quote.data.cod.available && method === 'cod') setMethod('online');
  }, [quote.data, method]);

  const place = useMutation({
    mutationFn: () =>
      api.post<PlaceOrderResult>(
        '/orders',
        { addressId, paymentMethod: method, couponCode: coupon, expectedTotal: quote.data!.total },
        { 'Idempotency-Key': idempotencyKey.current },
      ),
    onSuccess: (res) => {
      idempotencyKey.current = newIdempotencyKey();
      void qc.invalidateQueries({ queryKey: keys.cart });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      if (res.order.paymentMethod === 'cod') {
        navigate(`/orders/${res.order.orderNumber}?placed=1`);
      } else if (res.payment) {
        setPay({ orderNumber: res.order.orderNumber, payment: res.payment });
      } else {
        toast.error(res.paymentError?.message ?? 'Payment could not start.');
        navigate(`/orders/${res.order.orderNumber}`);
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRICE_CHANGED') {
        setNotice('Prices changed while you were checking out. We have updated your total — please review it.');
        void quote.refetch();
      } else if (e instanceof ApiError && e.code === 'OUT_OF_STOCK') {
        setNotice('Some items just sold out or are low on stock. Update your cart to continue.');
        void quote.refetch();
      } else if (e instanceof ApiError && e.code === 'COUPON_INVALID') {
        setCoupon(undefined);
        setNotice(e.message);
      } else {
        toast.error(errorMessage(e));
      }
    },
  });

  if (quote.isError) return <div className="container-page py-10"><ErrorState error={quote.error} onRetry={() => quote.refetch()} /></div>;
  if (quote.data && quote.data.lines.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState title="Your cart is empty" action={<ButtonLink to="/products">Browse products</ButtonLink>}>Add something to your cart to check out.</EmptyState>
      </div>
    );
  }
  const q = quote.data;
  const blocking = (q?.issues.length ?? 0) > 0;
  const canPlace = Boolean(q && addressId && !blocking && !quote.isFetching);

  return (
    <div className="container-page py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Checkout</h1>
      {notice && (
        <Alert tone="warning" className="mb-4">
          <div className="flex items-start justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-brand-700" /> 1. Delivery address</h2>
              <Button variant="outline" size="sm" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>Add address</Button>
            </div>
            {addresses.isPending ? (
              <Skeleton className="h-24" />
            ) : addresses.isError ? (
              <ErrorState error={addresses.error} onRetry={() => addresses.refetch()} />
            ) : addresses.data.length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-300 p-4">
                <p className="mb-3 text-sm text-stone-600">Add where we should deliver your order.</p>
                <AddressForm onDone={(a) => setAddressId(a.id)} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Delivery address">
                {addresses.data.map((a) => (
                  <label key={a.id} className={cx('flex cursor-pointer gap-3 rounded-lg border p-4', addressId === a.id ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-stone-200 hover:bg-stone-50')}>
                    <input type="radio" name="address" className="mt-1 accent-brand-700" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                    <div>
                      <div className="mb-1 flex gap-2">
                        {a.label && <Badge>{a.label}</Badge>}
                        {a.isDefault && <Badge tone="brand">Default</Badge>}
                      </div>
                      <AddressLines a={a} />
                    </div>
                  </label>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-brand-700" /> 2. Payment method</h2>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
              <label className={cx('flex cursor-pointer gap-3 rounded-lg border p-4', method === 'online' ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-stone-200')}>
                <input type="radio" name="method" className="mt-1 accent-brand-700" checked={method === 'online'} onChange={() => setMethod('online')} />
                <div>
                  <p className="font-medium">Pay online with DemoPay</p>
                  <p className="text-sm text-stone-500">UPI, card, netbanking or wallet — virtual money, like a real gateway.</p>
                </div>
              </label>
              <label className={cx('flex gap-3 rounded-lg border p-4', !q?.cod.available ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', method === 'cod' ? 'border-brand-600 bg-brand-50/50 ring-1 ring-brand-600' : 'border-stone-200')}>
                <input type="radio" name="method" className="mt-1 accent-brand-700" disabled={!q?.cod.available} checked={method === 'cod'} onChange={() => setMethod('cod')} />
                <div>
                  <p className="flex items-center gap-1.5 font-medium"><Banknote className="size-4" /> Cash on Delivery</p>
                  <p className="text-sm text-stone-500">{q && !q.cod.available && q.cod.reason ? COD_REASONS[q.cod.reason] : 'Pay when your order arrives.'}</p>
                </div>
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Tag className="size-4 text-brand-700" /> 3. Coupon</h2>
            {q?.coupon ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <span><strong>{q.coupon.code}</strong> applied — you save {formatINR(q.coupon.discount)}</span>
                <Button variant="ghost" size="sm" onClick={() => { setCoupon(undefined); setCouponDraft(''); }}>Remove</Button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (couponDraft.trim()) setCoupon(couponDraft.trim().toUpperCase());
                }}
              >
                <Input className="flex-1" aria-label="Coupon code" placeholder="Try WELCOME10, FLAT150 or FESTIVE25" value={couponDraft} onChange={(e) => setCouponDraft(e.target.value.toUpperCase())} error={q?.couponError ? couponReason(q.couponError.reason) : undefined} />
                <Button type="submit" variant="outline" loading={quote.isFetching && Boolean(coupon)}>Apply</Button>
              </form>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5 lg:sticky lg:top-24">
          <h2 className="font-semibold">4. Review & place order</h2>
          {!q ? (
            <Skeleton className="mt-4 h-48" />
          ) : (
            <>
              <ul className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                {q.lines.map((l) => (
                  <li key={l.id} className="flex gap-3 text-sm">
                    <div className="size-14 shrink-0 overflow-hidden rounded-md bg-stone-100">{l.imageUrl && <img src={l.imageUrl} alt="" className="size-full object-cover" />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium">{l.name}</p>
                      <p className="text-stone-500">{l.variantLabel} · Qty {l.quantity}</p>
                      {l.issues.length > 0 && <p className="text-xs text-rose-600">Unavailable in this quantity</p>}
                    </div>
                    <p className="font-medium">{formatINR(l.lineTotal)}</p>
                  </li>
                ))}
              </ul>
              {q.warnings.length > 0 && <Alert tone="info" className="mt-3">Some prices changed since you added them; totals below are current.</Alert>}
              <dl className="mt-4 space-y-2 border-t border-stone-200 pt-4 text-sm">
                <Row label="Subtotal" value={formatINR(q.subtotal)} />
                {q.discount > 0 && <Row label="Discount" value={`− ${formatINR(q.discount)}`} className="text-emerald-700" />}
                <Row label="Shipping" value={q.shippingFee === 0 ? 'Free' : formatINR(q.shippingFee)} />
                <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd>{formatINR(q.total)}</dd>
                </div>
                <p className="text-xs text-stone-500">Inclusive of all taxes</p>
              </dl>
              {blocking && (
                <Alert tone="error" className="mt-3">
                  Some items are unavailable. <Link to="/cart" className="font-medium underline">Review your cart</Link>.
                </Alert>
              )}
              <Button size="lg" className="mt-4 w-full" disabled={!canPlace} loading={place.isPending} onClick={() => place.mutate()}>
                {method === 'cod' ? `Place order · ${formatINR(q.total)}` : `Continue to payment · ${formatINR(q.total)}`}
              </Button>
              {method === 'online' && <p className="mt-2 text-center text-xs text-stone-500">Items are reserved for {config.data?.paymentWindowMinutes ?? 15} minutes while you pay.</p>}
            </>
          )}
        </Card>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a delivery address" size="lg">
        <AddressForm
          onDone={(a) => {
            setAddressId(a.id);
            setAddOpen(false);
          }}
          onCancel={() => setAddOpen(false)}
        />
      </Modal>

      {pay && (
        <DemoPayCheckout
          open
          orderNumber={pay.orderNumber}
          payment={pay.payment}
          storeName={config.data?.storeName ?? 'Storefront Demo'}
          onClose={() => navigate(`/orders/${pay.orderNumber}`)}
          onPaid={() => {
            void qc.invalidateQueries({ queryKey: keys.cart });
            navigate(`/orders/${pay.orderNumber}?placed=1`);
          }}
          onClosedEarly={() => navigate(`/orders/${pay.orderNumber}?webhook=1`)}
        />
      )}
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cx('flex justify-between', className)}>
      <dt className="text-stone-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function couponReason(reason: string) {
  const map: Record<string, string> = {
    not_found: 'That coupon code does not exist.',
    inactive: 'That coupon is no longer active.',
    not_started: 'That coupon is not valid yet.',
    expired: 'That coupon has expired.',
    min_order_value: 'Your order is below this coupon’s minimum value.',
    usage_limit_reached: 'That coupon has been fully used.',
    per_user_limit_reached: 'You have already used this coupon.',
  };
  return map[reason] ?? 'This coupon cannot be applied.';
}
