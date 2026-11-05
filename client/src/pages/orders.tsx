import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Clock, Package, Truck } from 'lucide-react';
import {
  ORDER_PROGRESS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderSummary,
  type PageMeta,
  type PaymentInit,
} from '@shop/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
  Select,
  Skeleton,
  Textarea,
  cx,
  useDocumentTitle,
} from '../components/ui';
import { AddressLines } from '../features/address';
import { keys, useConfig } from '../features/hooks';
import { DemoPayCheckout } from '../features/payment';
import { countdown, formatDate, formatDateTime, formatINR, label, useNow } from '../lib/format';
import { api, errorMessage, qs, request } from '../services/api';
import { toast } from '../store/local';

export function OrdersPage() {
  useDocumentTitle('My orders');
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const status = params.get('status') ?? undefined;
  const orders = useQuery({
    queryKey: keys.orders({ page, status }),
    queryFn: () => request<{ data: OrderSummary[]; meta: PageMeta }>(`/orders${qs({ page, status })}`),
  });
  return (
    <div className="container-page py-8">
      <PageHeader
        title="My orders"
        actions={
          <Select aria-label="Filter by status" value={status ?? ''} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
            <option value="">All orders</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        }
      />
      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
      ) : orders.isPending ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : orders.data.data.length === 0 ? (
        <EmptyState icon={<Package className="size-10" />} title={status ? 'No orders with this status' : 'No orders yet'} action={<ButtonLink to="/products">Start shopping</ButtonLink>}>
          Orders you place will appear here with live tracking.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {orders.data.data.map((o) => (
              <li key={o.orderNumber}>
                <Link to={`/orders/${o.orderNumber}`} className="flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-300">
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">{o.firstItemImageUrl && <img src={o.firstItemImageUrl} alt="" className="size-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-stone-900">{o.orderNumber}</p>
                      <OrderStatusBadge status={o.status} />
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </div>
                    <p className="mt-1 truncate text-sm text-stone-600">
                      {o.firstItemName}
                      {o.itemCount > 1 ? ` and ${o.itemCount - 1} more` : ''}
                    </p>
                    <p className="text-xs text-stone-500">
                      Placed {formatDate(o.createdAt)} · {o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'DemoPay'}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold">{formatINR(o.total)}</p>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination meta={orders.data.meta} onPage={(p) => setParams({ ...(status ? { status } : {}), page: String(p) })} />
        </>
      )}
    </div>
  );
}

function Timeline({ order }: { order: Order }) {
  const reached = new Map(order.statusHistory.map((e) => [e.status, e]));
  const terminal = ['cancelled', 'expired', 'undelivered'].includes(order.status);
  return (
    <div>
      <ol className="grid grid-cols-4 gap-2">
        {ORDER_PROGRESS.map((s, i) => {
          const done = reached.has(s);
          const Icon = s === 'shipped' ? Truck : s === 'delivered' ? Package : CircleCheck;
          return (
            <li key={s} className="flex flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div className={cx('h-0.5 flex-1', i === 0 ? 'opacity-0' : done ? 'bg-brand-600' : 'bg-stone-200')} />
                <div className={cx('grid size-9 place-items-center rounded-full', done ? 'bg-brand-700 text-white' : 'bg-stone-100 text-stone-400')}>
                  <Icon className="size-4" />
                </div>
                <div className={cx('h-0.5 flex-1', i === ORDER_PROGRESS.length - 1 ? 'opacity-0' : reached.has(ORDER_PROGRESS[i + 1]!) ? 'bg-brand-600' : 'bg-stone-200')} />
              </div>
              <p className={cx('mt-2 text-xs font-medium', done ? 'text-stone-900' : 'text-stone-400')}>{ORDER_STATUS_LABELS[s]}</p>
              {reached.get(s) && <p className="text-[11px] text-stone-500">{formatDateTime(reached.get(s)!.at)}</p>}
            </li>
          );
        })}
      </ol>
      {terminal && <Alert tone="warning" className="mt-4">This order is <strong>{ORDER_STATUS_LABELS[order.status].toLowerCase()}</strong>{order.cancellation ? ` — ${order.cancellation.reason}` : ''}.</Alert>}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-stone-600">Full history ({order.statusHistory.length} events)</summary>
        <ul className="mt-2 space-y-1.5 border-l-2 border-stone-200 pl-4">
          {[...order.statusHistory].reverse().map((e, i) => (
            <li key={i}>
              <span className="font-medium">{ORDER_STATUS_LABELS[e.status]}</span> · {formatDateTime(e.at)} · <span className="text-stone-500">{e.actorType}</span>
              {e.note && <p className="text-stone-500">{e.note}</p>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function OrderPage() {
  const { orderNumber = '' } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const config = useConfig();
  const now = useNow();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState<PaymentInit | null>(null);
  useDocumentTitle(`Order ${orderNumber}`);

  const order = useQuery({
    queryKey: keys.order(orderNumber),
    queryFn: () => api.get<Order>(`/orders/${orderNumber}`),
    // Poll while something is still settling (payment window, webhook, refund).
    refetchInterval: (q) => {
      const o = q.state.data;
      if (!o) return false;
      const settling = o.status === 'pending_payment' || o.paymentStatus === 'refund_pending' || o.refunds.some((r) => r.status !== 'processed' && r.status !== 'failed');
      return settling ? 2500 : false;
    },
  });

  const startPay = useMutation({
    mutationFn: () => api.post<PaymentInit>(`/orders/${orderNumber}/payment`),
    onSuccess: setPay,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${orderNumber}/cancel`, { reason }),
    onSuccess: (o) => {
      qc.setQueryData(keys.order(orderNumber), o);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      setCancelOpen(false);
      toast.success(o.paymentStatus === 'refund_pending' ? 'Order cancelled — your refund is on its way.' : 'Order cancelled.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (order.isPending) return <div className="container-page space-y-4 py-8"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (order.isError) return <div className="container-page py-10"><ErrorState error={order.error} onRetry={() => order.refetch()} /></div>;
  const o = order.data;
  const msLeft = o.windowEndsAt ? new Date(o.windowEndsAt).getTime() - now : 0;

  return (
    <div className="container-page py-8">
      {params.get('placed') && o.status !== 'pending_payment' && (
        <Alert tone="success" className="mb-6">
          <p className="font-semibold">Thank you! Your order is confirmed.</p>
          <p>A confirmation email is in the <Link to="/demo/inbox" className="underline">demo inbox</Link>.</p>
        </Alert>
      )}
      {params.get('webhook') && o.status === 'pending_payment' && (
        <Alert tone="info" className="mb-6">The payment page was closed before it reported back. Waiting for DemoPay’s webhook to confirm the payment…</Alert>
      )}
      <PageHeader
        title={`Order ${o.orderNumber}`}
        subtitle={`Placed ${formatDateTime(o.createdAt)} · ${o.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Paid online with DemoPay'}`}
        actions={
          <>
            <OrderStatusBadge status={o.status} />
            <PaymentStatusBadge status={o.paymentStatus} />
          </>
        }
      />

      {o.status === 'pending_payment' && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-3">
            <Clock className="size-6 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Waiting for payment</p>
              <p className="text-sm text-amber-800">
                {o.canPay ? <>Your items are reserved for another <strong>{countdown(msLeft)}</strong>.</> : 'The payment window has closed. We are checking with DemoPay before releasing the items.'}
              </p>
            </div>
          </div>
          {o.canPay && (
            <Button onClick={() => startPay.mutate()} loading={startPay.isPending}>
              Pay {formatINR(o.pricing.total)} now
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-5 font-semibold">Tracking</h2>
            <Timeline order={o} />
            {o.fulfilment.trackingNumber && (
              <div className="mt-4 rounded-lg bg-stone-50 p-3 text-sm">
                Shipped with <strong>{o.fulfilment.carrier}</strong> · tracking number <strong>{o.fulfilment.trackingNumber}</strong>
              </div>
            )}
            {o.fulfilment.undeliveredReason && <p className="mt-2 text-sm text-stone-600">Reason: {label(o.fulfilment.undeliveredReason)}</p>}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Items</h2>
            <ul className="divide-y divide-stone-100">
              {o.items.map((i) => (
                <li key={i.sku} className="flex gap-3 py-3">
                  <Link to={`/p/${i.slug}`} className="size-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</Link>
                  <div className="min-w-0 flex-1 text-sm">
                    <Link to={`/p/${i.slug}`} className="font-medium hover:text-brand-700">{i.name}</Link>
                    <p className="text-stone-500">{i.variantLabel} · {i.quantity} × {formatINR(i.unitPrice)}</p>
                    {o.status === 'delivered' && <Link to={`/p/${i.slug}#reviews`} className="text-xs font-medium text-brand-700 hover:underline">Write a review</Link>}
                  </div>
                  <p className="text-sm font-medium">{formatINR(i.lineTotal)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Payment summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd>{formatINR(o.pricing.subtotal)}</dd></div>
              {o.pricing.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount {o.coupon && `(${o.coupon.code})`}</dt><dd>− {formatINR(o.pricing.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-stone-600">Shipping</dt><dd>{o.pricing.shippingFee === 0 ? 'Free' : formatINR(o.pricing.shippingFee)}</dd></div>
              <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatINR(o.pricing.total)}</dd></div>
            </dl>
            {o.refunds.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-stone-200 pt-4">
                <p className="text-sm font-medium">Refunds</p>
                {o.refunds.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span>{formatINR(r.amount)} · {label(r.reason)}</span>
                    <Badge tone={r.status === 'processed' ? 'green' : r.status === 'failed' ? 'red' : 'violet'}>{label(r.status)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Delivery address</h2>
            <AddressLines a={o.shippingAddress} />
          </Card>
          {o.canCancel && (
            <Button variant="outline" className="w-full" onClick={() => setCancelOpen(true)}>
              Cancel this order
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel order"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep order</Button>
            <Button variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>Cancel order</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-600">
          {o.paymentStatus === 'paid' ? 'Your payment will be refunded in full automatically (virtual money).' : 'The items will be released back to stock.'}
        </p>
        <Textarea label="Why are you cancelling?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ordered by mistake" />
      </Modal>

      {pay && (
        <DemoPayCheckout
          open
          orderNumber={o.orderNumber}
          payment={pay}
          storeName={config.data?.storeName ?? 'Storefront Demo'}
          onClose={() => setPay(null)}
          onPaid={(fresh) => {
            setPay(null);
            qc.setQueryData(keys.order(orderNumber), fresh);
            void qc.invalidateQueries({ queryKey: keys.cart });
            toast.success('Payment received — order confirmed!');
          }}
          onClosedEarly={() => {
            setPay(null);
            toast.info('Payment page closed. Waiting for the webhook…');
            void order.refetch();
          }}
        />
      )}
    </div>
  );
}
