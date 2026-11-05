import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, RefreshCw, SlidersHorizontal } from 'lucide-react';
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  REFUND_STATUSES,
  UNDELIVERED_REASONS,
  type AdminCustomerRow,
  type AdminOrder,
  type AdminOrderRow,
  type AdminRefundRow,
  type Address,
  type InventoryMovementRow,
  type InventoryRow,
  type OrderStatus,
  type OrderSummary,
  type PageMeta,
} from '@shop/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
  useDocumentTitle,
} from '../../components/ui';
import { AddressLines } from '../../features/address';
import { formatDate, formatDateTime, formatINR, label, useDebounced } from '../../lib/format';
import { api, errorMessage, qs, request } from '../../services/api';
import { toast } from '../../store/local';

function useSearchState(key = 'q') {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(params.get(key) ?? '');
  const debounced = useDebounced(value, 300);
  useEffect(() => {
    if (debounced !== (params.get(key) ?? '')) {
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (debounced) n.set(key, debounced);
        else n.delete(key);
        n.delete('page');
        return n;
      });
    }
  }, [debounced, key, params, setParams]);
  const setParam = (k: string, v: string | undefined) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      if (k !== 'page') n.delete('page');
      return n;
    });
  return { params, value, setValue, debounced, setParam };
}

// ---------------------------------------------------------------- orders

export function AdminOrders() {
  useDocumentTitle('Orders');
  const s = useSearchState();
  const filters = {
    q: s.debounced,
    status: s.params.get('status') ?? undefined,
    paymentMethod: s.params.get('paymentMethod') ?? undefined,
    needsReview: s.params.get('needsReview') ?? undefined,
    page: Number(s.params.get('page') ?? 1),
  };
  const list = useQuery({ queryKey: ['admin', 'orders', filters], queryFn: () => request<{ data: AdminOrderRow[]; meta: PageMeta }>(`/admin/orders${qs(filters)}`), refetchInterval: 10_000 });
  return (
    <div>
      <PageHeader title="Orders" subtitle="Live list — refreshes every few seconds." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-full sm:w-72" placeholder="Order number, email or name" aria-label="Search orders" value={s.value} onChange={(e) => s.setValue(e.target.value)} />
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => s.setParam('status', e.target.value || undefined)}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((x) => <option key={x} value={x}>{ORDER_STATUS_LABELS[x]}</option>)}
        </Select>
        <Select aria-label="Payment method" value={filters.paymentMethod ?? ''} onChange={(e) => s.setParam('paymentMethod', e.target.value || undefined)}>
          <option value="">All payment methods</option>
          <option value="online">DemoPay (online)</option>
          <option value="cod">Cash on Delivery</option>
        </Select>
        <div className="flex items-center px-2"><Checkbox label="Needs review" checked={filters.needsReview === 'true'} onChange={(e) => s.setParam('needsReview', e.target.checked ? 'true' : undefined)} /></div>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-96" />
      ) : list.data.data.length === 0 ? (
        <EmptyState title="No orders match these filters" />
      ) : (
        <>
          <Table>
            <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Items</Th><Th>Status</Th><Th>Payment</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((o) => (
                <tr key={o.orderNumber} className="hover:bg-stone-50">
                  <Td>
                    <Link to={`/admin/orders/${o.orderNumber}`} className="font-medium text-brand-700 hover:underline">{o.orderNumber}</Link>
                    <p className="text-xs text-stone-500">{formatDateTime(o.createdAt)}</p>
                  </Td>
                  <Td><p>{o.customerName}</p><p className="text-xs text-stone-500">{o.customerEmail}</p></Td>
                  <Td>{o.itemCount}</Td>
                  <Td><div className="flex flex-wrap gap-1"><OrderStatusBadge status={o.status} />{o.needsReview && <Badge tone="red">Review</Badge>}</div></Td>
                  <Td><div className="flex flex-col gap-1"><PaymentStatusBadge status={o.paymentStatus} /><span className="text-xs text-stone-500">{o.paymentMethod === 'cod' ? 'COD' : 'DemoPay'}</span></div></Td>
                  <Td className="text-right font-medium">{formatINR(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={(p) => s.setParam('page', String(p))} />
        </>
      )}
    </div>
  );
}

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = { processing: 'Start processing', shipped: 'Mark shipped', delivered: 'Mark delivered', undelivered: 'Not delivered…' };

export function AdminOrderDetail() {
  const { orderNumber = '' } = useParams();
  const qc = useQueryClient();
  useDocumentTitle(`Order ${orderNumber}`);
  const order = useQuery({ queryKey: ['admin', 'order', orderNumber], queryFn: () => api.get<AdminOrder>(`/admin/orders/${orderNumber}`), refetchInterval: 5000 });
  const [modal, setModal] = useState<'shipped' | 'undelivered' | 'cancel' | null>(null);
  const [ship, setShip] = useState({ carrier: 'Delhivery', trackingNumber: '', trackingUrl: '' });
  const [undelivered, setUndelivered] = useState<(typeof UNDELIVERED_REASONS)[number]>('returned_to_origin');
  const [note, setNote] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    setModal(null);
    setNote('');
  };
  const transition = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/admin/orders/${orderNumber}/status`, body),
    onSuccess: () => { toast.success('Order updated'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/admin/orders/${orderNumber}/cancel`, { reason: note }),
    onSuccess: () => { toast.success('Order cancelled'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (resolution: 'keep' | 'cancel') => api.post(`/admin/orders/${orderNumber}/review`, { resolution, note: 'Resolved by admin' }),
    onSuccess: () => { toast.success('Review resolved'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (order.isPending) return <Skeleton className="h-96" />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  const o = order.data;

  return (
    <div className="max-w-6xl">
      <Link to="/admin/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><ArrowLeft className="size-4" /> Orders</Link>
      <PageHeader
        title={o.orderNumber}
        subtitle={`Placed ${formatDateTime(o.createdAt)} · stock state: ${label(o.stockState)}`}
        actions={<><OrderStatusBadge status={o.status} /><PaymentStatusBadge status={o.paymentStatus} /></>}
      />
      {o.needsReview && (
        <Alert tone="warning" className="mb-4">
          <p><strong>Needs review:</strong> {o.needsReview.reason}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => resolve.mutate('keep')} loading={resolve.isPending}>Keep order</Button>
            {o.canCancel && <Button size="sm" variant="danger" onClick={() => resolve.mutate('cancel')} loading={resolve.isPending}>Cancel order</Button>}
          </div>
        </Alert>
      )}
      <Card className="mb-6 flex flex-wrap items-center gap-2 p-4">
        <span className="mr-2 text-sm font-medium text-stone-600">Actions:</span>
        {o.allowedTransitions.length === 0 && !o.canCancel && <span className="text-sm text-stone-500">None — this order is closed.</span>}
        {o.allowedTransitions.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={t === 'undelivered' ? 'outline' : 'primary'}
            loading={transition.isPending}
            onClick={() => (t === 'shipped' || t === 'undelivered' ? setModal(t) : transition.mutate({ status: t }))}
          >
            {ACTION_LABEL[t] ?? label(t)}
          </Button>
        ))}
        {o.canCancel && <Button size="sm" variant="danger" onClick={() => setModal('cancel')}>Cancel order</Button>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Items</h2>
            <ul className="divide-y divide-stone-100 text-sm">
              {o.items.map((i) => (
                <li key={i.sku} className="flex items-center gap-3 py-2">
                  <div className="size-12 shrink-0 overflow-hidden rounded bg-stone-100">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</div>
                  <div className="min-w-0 flex-1"><p className="font-medium">{i.name}</p><p className="text-stone-500">{i.variantLabel} · SKU {i.sku}</p></div>
                  <p>{i.quantity} × {formatINR(i.unitPrice)}</p>
                  <p className="w-24 text-right font-medium">{formatINR(i.lineTotal)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatINR(o.pricing.subtotal)}</dd></div>
              {o.pricing.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount {o.coupon?.code}</dt><dd>− {formatINR(o.pricing.discount)}</dd></div>}
              <div className="flex justify-between"><dt>Shipping</dt><dd>{formatINR(o.pricing.shippingFee)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatINR(o.pricing.total)}</dd></div>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Payments</h2>
            {o.payments.length === 0 ? (
              <p className="text-sm text-stone-500">{o.paymentMethod === 'cod' ? 'Cash is collected on delivery.' : 'No payment received yet.'}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2">
                    <span>{p.provider === 'cod' ? 'Cash' : p.gatewayPaymentId} · {p.method?.toUpperCase()}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={p.status === 'captured' ? 'green' : p.status === 'failed' ? 'red' : 'violet'}>{label(p.status)}</Badge>
                      {p.disposition === 'refund_required' && <Badge tone="amber">Auto-refund</Badge>}
                      <strong>{formatINR(p.amount)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {o.refunds.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold">Refunds</h3>
                <ul className="space-y-1 text-sm">
                  {o.refunds.map((r) => (
                    <li key={r.id} className="flex justify-between"><span>{label(r.reason)} · {formatDateTime(r.requestedAt)}</span><span className="flex gap-2"><Badge tone={r.status === 'processed' ? 'green' : r.status === 'failed' ? 'red' : 'violet'}>{label(r.status)}</Badge>{formatINR(r.amount)}</span></li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">History</h2>
            <ol className="space-y-2 border-l-2 border-stone-200 pl-4 text-sm">
              {[...o.statusHistory].reverse().map((e, i) => (
                <li key={i}><strong>{ORDER_STATUS_LABELS[e.status]}</strong> · {formatDateTime(e.at)} · <span className="text-stone-500">{e.actorType}</span>{e.note && <p className="text-stone-500">{e.note}</p>}</li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">Customer</h2>
            <p className="text-sm font-medium">{o.customer.name}</p>
            <p className="text-sm text-stone-500">{o.customer.email}</p>
            <Link to={`/admin/customers?q=${encodeURIComponent(o.customer.email)}`} className="mt-2 inline-block text-sm text-brand-700 hover:underline">View customer</Link>
          </Card>
          <Card className="p-5"><h2 className="mb-2 font-semibold">Ship to</h2><AddressLines a={o.shippingAddress} /></Card>
          {o.fulfilment.trackingNumber && <Card className="p-5 text-sm"><h2 className="mb-2 font-semibold">Shipment</h2>{o.fulfilment.carrier} · {o.fulfilment.trackingNumber}</Card>}
        </div>
      </div>

      <Modal open={modal === 'shipped'} onClose={() => setModal(null)} title="Mark as shipped" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button loading={transition.isPending} disabled={!ship.trackingNumber} onClick={() => transition.mutate({ status: 'shipped', carrier: ship.carrier, trackingNumber: ship.trackingNumber, ...(ship.trackingUrl ? { trackingUrl: ship.trackingUrl } : {}) })}>Mark shipped</Button></>}>
        <div className="space-y-3">
          <Select label="Carrier" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })}>{['Delhivery', 'Blue Dart', 'Ekart', 'India Post', 'DTDC'].map((c) => <option key={c}>{c}</option>)}</Select>
          <Input label="Tracking number" value={ship.trackingNumber} onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })} />
          <Input label="Tracking link (optional)" placeholder="https://…" value={ship.trackingUrl} onChange={(e) => setShip({ ...ship, trackingUrl: e.target.value })} />
        </div>
      </Modal>
      <Modal open={modal === 'undelivered'} onClose={() => setModal(null)} title="Order not delivered" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button loading={transition.isPending} onClick={() => transition.mutate({ status: 'undelivered', undeliveredReason: undelivered, note })}>Confirm</Button></>}>
        <div className="space-y-3">
          <Select label="What happened?" value={undelivered} onChange={(e) => setUndelivered(e.target.value as typeof undelivered)}>
            <option value="returned_to_origin">Returned to origin (restock)</option>
            <option value="refused">Refused by customer (restock)</option>
            <option value="lost_in_transit">Lost in transit (write off)</option>
          </Select>
          <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {o.paymentStatus === 'paid' && o.paymentMethod === 'online' && <Alert tone="info">The online payment will be refunded automatically.</Alert>}
        </div>
      </Modal>
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel order" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Back</Button><Button variant="danger" loading={cancel.isPending} disabled={note.trim().length < 3} onClick={() => cancel.mutate()}>Cancel order</Button></>}>
        <Textarea label="Reason (shown to the customer)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        {o.paymentStatus === 'paid' && <Alert tone="info" className="mt-3">The payment will be refunded in full automatically.</Alert>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- inventory

export function AdminInventory() {
  useDocumentTitle('Inventory');
  const qc = useQueryClient();
  const s = useSearchState();
  const lowStock = s.params.get('lowStock') === 'true';
  const page = Number(s.params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['admin', 'inventory', { q: s.debounced, lowStock, page }], queryFn: () => request<{ data: InventoryRow[]; meta: PageMeta }>(`/admin/inventory${qs({ q: s.debounced, lowStock: lowStock || undefined, page })}`) });
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<InventoryRow | null>(null);
  const [adj, setAdj] = useState({ type: 'restock' as 'restock' | 'adjustment', delta: '10', reason: 'Received new stock', threshold: '' });
  const movements = useQuery({ queryKey: ['admin', 'movements', history?.sku], queryFn: () => request<{ data: InventoryMovementRow[]; meta: PageMeta }>(`/admin/inventory/${encodeURIComponent(history!.sku)}/movements`), enabled: Boolean(history) });

  const adjust = useMutation({
    mutationFn: async () => {
      const row = adjusting!;
      if (Number(adj.delta) !== 0) await api.post(`/admin/inventory/${encodeURIComponent(row.sku)}/adjust`, { type: adj.type, delta: Number(adj.delta), reason: adj.reason });
      if (adj.threshold !== '' && Number(adj.threshold) !== row.lowStockThreshold) await api.patch(`/admin/inventory/${encodeURIComponent(row.sku)}`, { lowStockThreshold: Number(adj.threshold) });
    },
    onSuccess: () => {
      toast.success('Stock updated');
      setAdjusting(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Available can be sold · Reserved is held by unpaid orders · Allocated is sold but not yet shipped." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-full sm:w-72" placeholder="SKU or product name" aria-label="Search inventory" value={s.value} onChange={(e) => s.setValue(e.target.value)} />
        <div className="flex items-center px-2"><Checkbox label="Low stock only" checked={lowStock} onChange={(e) => s.setParam('lowStock', e.target.checked ? 'true' : undefined)} /></div>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-96" />
      ) : list.data.data.length === 0 ? (
        <EmptyState title="No SKUs match" />
      ) : (
        <>
          <Table>
            <thead><tr><Th>SKU</Th><Th>Product</Th><Th className="text-right">Available</Th><Th className="text-right">Reserved</Th><Th className="text-right">Allocated</Th><Th className="text-right">On hand</Th><Th>Low at</Th><Th /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((r) => (
                <tr key={r.sku} className="hover:bg-stone-50">
                  <Td className="font-mono text-xs">{r.sku}</Td>
                  <Td><Link to={`/admin/products/${r.productId}`} className="font-medium hover:text-brand-700">{r.productName}</Link><p className="text-xs text-stone-500">{r.variantLabel}</p></Td>
                  <Td className="text-right"><span className={r.available === 0 ? 'font-semibold text-rose-600' : r.isLowStock ? 'font-semibold text-amber-700' : ''}>{r.available}</span></Td>
                  <Td className="text-right text-stone-600">{r.reserved}</Td>
                  <Td className="text-right text-stone-600">{r.allocated}</Td>
                  <Td className="text-right">{r.onHand}</Td>
                  <Td>{r.lowStockThreshold}{r.isLowStock && <Badge tone="amber" className="ml-2">Low</Badge>}</Td>
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-4" />} onClick={() => { setAdjusting(r); setAdj({ type: 'restock', delta: '10', reason: 'Received new stock', threshold: String(r.lowStockThreshold) }); }}>Adjust</Button>
                    <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setHistory(r)} aria-label="Movement history" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={(p) => s.setParam('page', String(p))} />
        </>
      )}
      <Modal open={adjusting !== null} onClose={() => setAdjusting(null)} title={`Adjust ${adjusting?.sku ?? ''}`} footer={<><Button variant="ghost" onClick={() => setAdjusting(null)}>Cancel</Button><Button loading={adjust.isPending} onClick={() => adjust.mutate()}>Save</Button></>}>
        {adjusting && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">{adjusting.productName} · {adjusting.variantLabel} · currently <strong>{adjusting.available}</strong> available</p>
            <Select label="Type" value={adj.type} onChange={(e) => setAdj({ ...adj, type: e.target.value as typeof adj.type })}>
              <option value="restock">Restock (add units received)</option>
              <option value="adjustment">Adjustment (count correction, damage…)</option>
            </Select>
            <Input label="Change in units" type="number" hint={adj.type === 'adjustment' ? 'Use a negative number to remove units.' : undefined} value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} />
            <Input label="Reason (recorded in the ledger)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
            <Input label="Low-stock alert at" type="number" value={adj.threshold} onChange={(e) => setAdj({ ...adj, threshold: e.target.value })} />
          </div>
        )}
      </Modal>
      <Modal open={history !== null} onClose={() => setHistory(null)} title={`Stock movements · ${history?.sku ?? ''}`} size="lg">
        {movements.isPending ? <Skeleton className="h-40" /> : movements.isError ? <ErrorState error={movements.error} /> : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-stone-500"><th className="py-1">When</th><th>Type</th><th className="text-right">Avail.</th><th className="text-right">Res.</th><th className="text-right">Alloc.</th><th className="pl-3">Ref</th></tr></thead>
            <tbody>
              {movements.data.data.map((m) => (
                <tr key={m.id} className="border-t border-stone-100">
                  <td className="py-1.5 text-stone-500">{formatDateTime(m.createdAt)}</td>
                  <td>{label(m.type)}</td>
                  {(['available', 'reserved', 'allocated'] as const).map((k) => <td key={k} className={`text-right tabular-nums ${m.delta[k] > 0 ? 'text-emerald-700' : m.delta[k] < 0 ? 'text-rose-600' : 'text-stone-300'}`}>{m.delta[k] > 0 ? `+${m.delta[k]}` : m.delta[k] || '·'}</td>)}
                  <td className="pl-3 text-xs text-stone-500">{m.orderNumber ? <Link to={`/admin/orders/${m.orderNumber}`} className="text-brand-700">{m.orderNumber}</Link> : m.reason}{m.actorName ? ` · ${m.actorName}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- customers

interface CustomerDetail { id: string; name: string; email: string; phone: string | null; status: string; createdAt: string; lastLoginAt: string | null; addresses: Address[]; recentOrders: OrderSummary[] }

export function AdminCustomers() {
  useDocumentTitle('Customers');
  const qc = useQueryClient();
  const s = useSearchState();
  const page = Number(s.params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['admin', 'customers', { q: s.debounced, page }], queryFn: () => request<{ data: AdminCustomerRow[]; meta: PageMeta }>(`/admin/customers${qs({ q: s.debounced, page })}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['admin', 'customer', selected], queryFn: () => api.get<CustomerDetail>(`/admin/customers/${selected}`), enabled: Boolean(selected) });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'blocked' }) => api.patch(`/admin/customers/${id}`, { status }),
    onSuccess: (_d, v) => {
      toast.success(v.status === 'blocked' ? 'Customer blocked and signed out' : 'Customer unblocked');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Customers" />
      <Input className="mb-4 w-full sm:w-72" placeholder="Name or email" aria-label="Search customers" value={s.value} onChange={(e) => s.setValue(e.target.value)} />
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-96" /> : list.data.data.length === 0 ? <EmptyState title="No customers found" /> : (
        <>
          <Table>
            <thead><tr><Th>Customer</Th><Th>Joined</Th><Th className="text-right">Orders</Th><Th className="text-right">Lifetime spend</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <Td><button className="text-left font-medium hover:text-brand-700" onClick={() => setSelected(c.id)}>{c.name}</button><p className="text-xs text-stone-500">{c.email}</p></Td>
                  <Td className="text-stone-500">{formatDate(c.createdAt)}</Td>
                  <Td className="text-right">{c.orderCount}</Td>
                  <Td className="text-right">{formatINR(c.lifetimeSpend)}</Td>
                  <Td><Badge tone={c.status === 'active' ? 'green' : 'red'}>{label(c.status)}</Badge></Td>
                  <Td>
                    <Button size="sm" variant={c.status === 'active' ? 'ghost' : 'outline'} loading={setStatus.isPending && setStatus.variables?.id === c.id} onClick={() => (c.status === 'active' ? confirm(`Block ${c.name}? They will be signed out and unpaid orders cancelled.`) && setStatus.mutate({ id: c.id, status: 'blocked' }) : setStatus.mutate({ id: c.id, status: 'active' }))}>
                      {c.status === 'active' ? 'Block' : 'Unblock'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={(p) => s.setParam('page', String(p))} />
        </>
      )}
      <Modal open={selected !== null} onClose={() => setSelected(null)} title={detail.data?.name ?? 'Customer'} size="lg">
        {detail.isPending ? <Skeleton className="h-40" /> : detail.isError ? <ErrorState error={detail.error} /> : (
          <div className="space-y-4 text-sm">
            <p>{detail.data.email} · {detail.data.phone ?? 'no phone'} · joined {formatDate(detail.data.createdAt)}{detail.data.lastLoginAt && ` · last sign-in ${formatDateTime(detail.data.lastLoginAt)}`}</p>
            <div className="grid gap-3 sm:grid-cols-2">{detail.data.addresses.map((a) => <div key={a.id} className="rounded-lg bg-stone-50 p-3"><AddressLines a={a} /></div>)}</div>
            <div>
              <h3 className="mb-2 font-semibold">Recent orders</h3>
              {detail.data.recentOrders.length === 0 ? <p className="text-stone-500">No orders yet.</p> : (
                <ul className="divide-y divide-stone-100">
                  {detail.data.recentOrders.map((o) => <li key={o.orderNumber} className="flex items-center justify-between py-2"><Link to={`/admin/orders/${o.orderNumber}`} className="text-brand-700">{o.orderNumber}</Link><OrderStatusBadge status={o.status} /><span>{formatINR(o.total)}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- refunds

export function AdminRefunds() {
  useDocumentTitle('Refunds');
  const qc = useQueryClient();
  const s = useSearchState();
  const status = s.params.get('status') ?? undefined;
  const page = Number(s.params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['admin', 'refunds', { status, page }], queryFn: () => request<{ data: AdminRefundRow[]; meta: PageMeta }>(`/admin/refunds${qs({ status, page })}`), refetchInterval: 5000 });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/refunds/${id}/retry`),
    onSuccess: () => { toast.success('Refund queued again'); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Refunds" subtitle="Every refund is queued, sent to DemoPay by a background job, and confirmed by webhook." />
      <Select className="mb-4 w-56" aria-label="Status" value={status ?? ''} onChange={(e) => s.setParam('status', e.target.value || undefined)}>
        <option value="">All statuses</option>
        {REFUND_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
      </Select>
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-64" /> : list.data.data.length === 0 ? <EmptyState title="No refunds">Refunds appear when paid orders are cancelled, returned, or paid late.</EmptyState> : (
        <>
          <Table>
            <thead><tr><Th>Order</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Requested</Th><Th>Processed</Th><Th /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((r) => (
                <tr key={r.id}>
                  <Td><Link to={`/admin/orders/${r.orderNumber}`} className="font-medium text-brand-700">{r.orderNumber}</Link></Td>
                  <Td>{label(r.reason)}</Td>
                  <Td className="text-right font-medium">{formatINR(r.amount)}</Td>
                  <Td><Badge tone={r.status === 'processed' ? 'green' : r.status === 'failed' ? 'red' : 'violet'}>{label(r.status)}</Badge>{r.lastError && <p className="mt-1 max-w-48 truncate text-xs text-rose-600" title={r.lastError}>{r.lastError}</p>}</Td>
                  <Td className="text-stone-500">{formatDateTime(r.requestedAt)}</Td>
                  <Td className="text-stone-500">{r.processedAt ? formatDateTime(r.processedAt) : '—'}</Td>
                  <Td>{r.status === 'failed' && <Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => retry.mutate(r.id)}>Retry</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={(p) => s.setParam('page', String(p))} />
        </>
      )}
    </div>
  );
}
