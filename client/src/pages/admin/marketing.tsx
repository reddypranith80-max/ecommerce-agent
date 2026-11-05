import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Download, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AdminCoupon, AdminReviewRow, AuditLogRow, PageMeta, SalesReportRow, StoreSettings } from '@shop/shared';
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
  PageHeader,
  Pagination,
  RatingStars,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
  useDocumentTitle,
} from '../../components/ui';
import { formatDate, formatDateTime, formatINR, label, paiseToRupees, rupeesToPaise } from '../../lib/format';
import { ApiError, api, downloadFile, errorMessage, qs, request } from '../../services/api';
import { toast } from '../../store/local';
import { BarChart } from './layout';

// ---------------------------------------------------------------- coupons

interface CouponForm {
  code: string; description: string; type: 'percentage' | 'fixed'; value: string; maxDiscount: string; minOrderValue: string;
  startsAt: string; endsAt: string; usageLimit: string; perUserLimit: string; isActive: boolean;
}
const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function AdminCoupons() {
  useDocumentTitle('Coupons');
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['admin', 'coupons', page], queryFn: () => request<{ data: AdminCoupon[]; meta: PageMeta }>(`/admin/coupons${qs({ page })}`) });
  const [editing, setEditing] = useState<AdminCoupon | 'new' | null>(null);
  const [usage, setUsage] = useState<AdminCoupon | null>(null);
  const redemptions = useQuery({
    queryKey: ['admin', 'redemptions', usage?.id],
    queryFn: () => request<{ data: { orderNumber: string; customerEmail: string; discount: number; status: string; createdAt: string }[]; meta: PageMeta }>(`/admin/coupons/${usage!.id}/redemptions`),
    enabled: Boolean(usage),
  });
  const form = useForm<CouponForm>();
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setFormError(null);
    const now = new Date();
    if (editing === 'new') {
      form.reset({ code: '', description: '', type: 'percentage', value: '10', maxDiscount: '200', minOrderValue: '0', startsAt: toLocalInput(now.toISOString()), endsAt: toLocalInput(new Date(now.getTime() + 30 * 86_400_000).toISOString()), usageLimit: '', perUserLimit: '1', isActive: true });
    } else {
      form.reset({
        code: editing.code, description: editing.description, type: editing.type,
        value: editing.type === 'fixed' ? paiseToRupees(editing.value) : String(editing.value),
        maxDiscount: editing.maxDiscount ? paiseToRupees(editing.maxDiscount) : '', minOrderValue: paiseToRupees(editing.minOrderValue),
        startsAt: toLocalInput(editing.startsAt), endsAt: toLocalInput(editing.endsAt), usageLimit: editing.usageLimit?.toString() ?? '',
        perUserLimit: String(editing.perUserLimit), isActive: editing.isActive,
      });
    }
  }, [editing, form]);

  const save = useMutation({
    mutationFn: (v: CouponForm) => {
      const body = {
        code: v.code.toUpperCase(), description: v.description, type: v.type,
        value: v.type === 'fixed' ? rupeesToPaise(v.value) : Number(v.value),
        maxDiscount: v.type === 'percentage' && v.maxDiscount ? rupeesToPaise(v.maxDiscount) : null,
        minOrderValue: rupeesToPaise(v.minOrderValue || 0),
        startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString(),
        usageLimit: v.usageLimit ? Number(v.usageLimit) : null, perUserLimit: Number(v.perUserLimit || 1), isActive: v.isActive,
      };
      return editing === 'new' ? api.post('/admin/coupons', body) : api.patch(`/admin/coupons/${(editing as AdminCoupon).id}`, { ...body, version: (editing as AdminCoupon).version });
    },
    onSuccess: () => { toast.success('Coupon saved'); setEditing(null); void qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); },
    onError: (e) => setFormError(e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join(' · ') : errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/coupons/${id}`),
    onSuccess: () => { toast.success('Coupon deleted'); void qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const type = form.watch('type');
  const tone = { active: 'green', scheduled: 'blue', expired: 'stone', inactive: 'stone' } as const;

  return (
    <div>
      <PageHeader title="Coupons" actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>New coupon</Button>} />
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-64" /> : list.data.data.length === 0 ? <EmptyState title="No coupons yet" /> : (
        <>
          <Table>
            <thead><tr><Th>Code</Th><Th>Discount</Th><Th>Min. order</Th><Th>Valid</Th><Th className="text-right">Used</Th><Th>State</Th><Th /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <Td><p className="font-mono font-semibold">{c.code}</p><p className="max-w-56 truncate text-xs text-stone-500">{c.description}</p></Td>
                  <Td>{c.type === 'percentage' ? `${c.value}%${c.maxDiscount ? ` (max ${formatINR(c.maxDiscount)})` : ''}` : formatINR(c.value)}</Td>
                  <Td>{formatINR(c.minOrderValue)}</Td>
                  <Td className="whitespace-nowrap text-stone-500">{formatDate(c.startsAt)} – {formatDate(c.endsAt)}</Td>
                  <Td className="text-right"><button className="text-brand-700 hover:underline" onClick={() => setUsage(c)}>{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</button></Td>
                  <Td><Badge tone={tone[c.state]}>{label(c.state)}</Badge></Td>
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}><Pencil className="size-4" /></Button>
                    {c.usedCount === 0 && <Button size="sm" variant="ghost" onClick={() => confirm(`Delete ${c.code}?`) && remove.mutate(c.id)} aria-label={`Delete ${c.code}`}><Trash2 className="size-4" /></Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New coupon' : 'Edit coupon'} size="lg" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Save coupon</Button></>}>
        {formError && <Alert tone="error" className="mb-3">{formError}</Alert>}
        {editing !== 'new' && editing && editing.usedCount > 0 && <Alert tone="info" className="mb-3">This coupon has been used, so its code, type and value are locked.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Code" {...form.register('code')} disabled={editing !== 'new' && Boolean(editing && editing.usedCount > 0)} />
          <Select label="Type" {...form.register('type')} disabled={editing !== 'new' && Boolean(editing && editing.usedCount > 0)}>
            <option value="percentage">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </Select>
          <Input label={type === 'fixed' ? 'Amount off (₹)' : 'Percent off'} type="number" {...form.register('value')} disabled={editing !== 'new' && Boolean(editing && editing.usedCount > 0)} />
          {type === 'percentage' && <Input label="Maximum discount (₹)" type="number" {...form.register('maxDiscount')} />}
          <Input label="Minimum order (₹)" type="number" {...form.register('minOrderValue')} />
          <Input label="Total uses allowed" type="number" placeholder="Unlimited" {...form.register('usageLimit')} />
          <Input label="Uses per customer" type="number" {...form.register('perUserLimit')} />
          <Input label="Starts" type="datetime-local" {...form.register('startsAt')} />
          <Input label="Ends" type="datetime-local" {...form.register('endsAt')} />
          <Textarea className="sm:col-span-2" label="Description" rows={2} {...form.register('description')} />
          <Checkbox label="Active" {...form.register('isActive')} />
        </div>
      </Modal>
      <Modal open={usage !== null} onClose={() => setUsage(null)} title={`Usage · ${usage?.code ?? ''}`} size="lg">
        {redemptions.isPending ? <Skeleton className="h-32" /> : redemptions.isError ? <ErrorState error={redemptions.error} /> : redemptions.data.data.length === 0 ? <p className="text-sm text-stone-500">Not used yet.</p> : (
          <ul className="divide-y divide-stone-100 text-sm">
            {redemptions.data.data.map((r) => (
              <li key={r.orderNumber} className="flex items-center justify-between py-2">
                <Link to={`/admin/orders/${r.orderNumber}`} className="text-brand-700">{r.orderNumber}</Link>
                <span className="text-stone-500">{r.customerEmail}</span>
                <span>{formatINR(r.discount)}</span>
                <Badge tone={r.status === 'active' ? 'green' : 'stone'}>{r.status === 'active' ? 'Counted' : 'Released'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- reviews

export function AdminReviews() {
  useDocumentTitle('Reviews');
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['admin', 'reviews', status, page], queryFn: () => request<{ data: AdminReviewRow[]; meta: PageMeta }>(`/admin/reviews${qs({ status, page })}`) });
  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'published' | 'hidden' }) => api.patch(`/admin/reviews/${id}`, { status }),
    onSuccess: () => { toast.success('Review updated — product rating recalculated'); void qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/reviews/${id}`),
    onSuccess: () => { toast.success('Review deleted'); void qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Reviews" subtitle="Reviews from verified buyers are published immediately; hide anything inappropriate." />
      <Select className="mb-4 w-48" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">All reviews</option>
        <option value="published">Published</option>
        <option value="hidden">Hidden</option>
      </Select>
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-64" /> : list.data.data.length === 0 ? <EmptyState title="No reviews" /> : (
        <>
          <div className="space-y-3">
            {list.data.data.map((r) => (
              <Card key={r.id} className="flex flex-wrap items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><RatingStars value={r.rating} /><span className="font-medium">{r.title}</span>{r.status === 'hidden' && <Badge>Hidden</Badge>}</div>
                  <p className="mt-1 text-sm text-stone-700">{r.body}</p>
                  <p className="mt-1 text-xs text-stone-500">{r.authorName} ({r.authorEmail}) on <Link to={`/p/${r.productSlug}`} className="text-brand-700">{r.productName}</Link> · {formatDate(r.createdAt)}</p>
                </div>
                <div className="flex gap-1">
                  {r.status === 'published' ? (
                    <Button size="sm" variant="outline" icon={<EyeOff className="size-4" />} onClick={() => moderate.mutate({ id: r.id, status: 'hidden' })}>Hide</Button>
                  ) : (
                    <Button size="sm" variant="outline" icon={<Eye className="size-4" />} onClick={() => moderate.mutate({ id: r.id, status: 'published' })}>Publish</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => confirm('Delete this review?') && remove.mutate(r.id)} aria-label="Delete review" />
                </div>
              </Card>
            ))}
          </div>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- reports

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function AdminReports() {
  useDocumentTitle('Reports');
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const report = useQuery({ queryKey: ['admin', 'report', from, to], queryFn: () => api.get<SalesReportRow[]>(`/admin/reports/sales${qs({ from, to })}`) });
  const totals = report.data?.reduce(
    (t, r) => ({ orders: t.orders + r.orders, gross: t.gross + r.grossSales, discounts: t.discounts + r.discounts, refunds: t.refunds + r.refunds, net: t.net + r.netRevenue }),
    { orders: 0, gross: 0, discounts: 0, refunds: 0, net: 0 },
  );
  return (
    <div>
      <PageHeader
        title="Sales report"
        subtitle="Gross sales count orders when they are confirmed; net revenue is money captured minus refunds, by day (IST)."
        actions={<Button variant="outline" icon={<Download className="size-4" />} onClick={() => downloadFile(`/admin/reports/sales${qs({ from, to, format: 'csv' })}`, `sales-${from}-to-${to}.csv`).catch((e) => toast.error(errorMessage(e)))}>Download CSV</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </div>
      {report.isError ? <ErrorState error={report.error} onRetry={() => report.refetch()} /> : !report.data || !totals ? <Skeleton className="h-96" /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[['Orders', String(totals.orders)], ['Gross sales', formatINR(totals.gross)], ['Discounts', formatINR(totals.discounts)], ['Refunds', formatINR(totals.refunds)], ['Net revenue', formatINR(totals.net)]].map(([k, v]) => (
              <Card key={k} className="p-4"><p className="text-xs uppercase text-stone-500">{k}</p><p className="mt-1 text-xl font-semibold">{v}</p></Card>
            ))}
          </div>
          <Card className="p-5"><BarChart data={report.data.map((r) => ({ label: r.date.slice(5), value: r.netRevenue }))} format={formatINR} /></Card>
          <Table>
            <thead><tr><Th>Date</Th><Th className="text-right">Orders</Th><Th className="text-right">Gross</Th><Th className="text-right">Discounts</Th><Th className="text-right">Shipping</Th><Th className="text-right">Refunds</Th><Th className="text-right">Net</Th><Th className="text-right">AOV</Th><Th className="text-right">Online / COD</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {[...report.data].reverse().map((r) => (
                <tr key={r.date} className={r.orders === 0 ? 'text-stone-400' : ''}>
                  <Td>{r.date}</Td><Td className="text-right">{r.orders}</Td><Td className="text-right">{formatINR(r.grossSales)}</Td><Td className="text-right">{formatINR(r.discounts)}</Td>
                  <Td className="text-right">{formatINR(r.shipping)}</Td><Td className="text-right">{formatINR(r.refunds)}</Td><Td className="text-right font-medium">{formatINR(r.netRevenue)}</Td>
                  <Td className="text-right">{formatINR(r.averageOrderValue)}</Td><Td className="text-right">{r.onlineOrders} / {r.codOrders}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings

type SettingsForm = Record<keyof Omit<StoreSettings, 'version' | 'codEnabled'>, string> & { codEnabled: boolean };
const MONEY_FIELDS = ['codMaxOrderValue', 'shippingFlatFee', 'freeShippingThreshold'] as const;

export function AdminSettings() {
  useDocumentTitle('Settings');
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<StoreSettings>('/admin/settings') });
  const form = useForm<SettingsForm>();
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    form.reset({
      storeName: s.storeName, supportEmail: s.supportEmail, supportPhone: s.supportPhone, codEnabled: s.codEnabled,
      codMaxOrderValue: paiseToRupees(s.codMaxOrderValue), codMaxOpenOrders: String(s.codMaxOpenOrders), shippingFlatFee: paiseToRupees(s.shippingFlatFee),
      freeShippingThreshold: paiseToRupees(s.freeShippingThreshold), paymentWindowMinutes: String(s.paymentWindowMinutes), paymentGraceMinutes: String(s.paymentGraceMinutes),
      defaultLowStockThreshold: String(s.defaultLowStockThreshold), heroTitle: s.heroTitle, heroSubtitle: s.heroSubtitle,
    });
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (v: SettingsForm) => {
      const body: Record<string, unknown> = { version: settings.data!.version, storeName: v.storeName, supportEmail: v.supportEmail, supportPhone: v.supportPhone, codEnabled: v.codEnabled, heroTitle: v.heroTitle, heroSubtitle: v.heroSubtitle };
      for (const k of MONEY_FIELDS) body[k] = rupeesToPaise(v[k]);
      for (const k of ['codMaxOpenOrders', 'paymentWindowMinutes', 'paymentGraceMinutes', 'defaultLowStockThreshold'] as const) body[k] = Number(v[k]);
      return api.patch<StoreSettings>('/admin/settings', body);
    },
    onSuccess: (s) => {
      qc.setQueryData(['admin', 'settings'], s);
      void qc.invalidateQueries({ queryKey: ['config'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const outage = useMutation({ mutationFn: () => api.post<{ message: string }>('/admin/demo/gateway-outage'), onSuccess: (r) => toast.info(r.message) });

  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  if (!settings.data) return <Skeleton className="h-96" />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Store settings" actions={<Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Save settings</Button>} />
      <div className="space-y-6">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Store</h2>
          <Input label="Store name" {...form.register('storeName')} />
          <Input label="Support email" {...form.register('supportEmail')} />
          <Input label="Support phone" {...form.register('supportPhone')} />
          <Input label="Default low-stock alert" type="number" {...form.register('defaultLowStockThreshold')} />
          <Input className="sm:col-span-2" label="Home page headline" {...form.register('heroTitle')} />
          <Textarea className="sm:col-span-2" label="Home page subtitle" rows={2} {...form.register('heroSubtitle')} />
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Shipping & Cash on Delivery</h2>
          <Input label="Flat shipping fee (₹)" type="number" {...form.register('shippingFlatFee')} />
          <Input label="Free shipping from (₹)" type="number" {...form.register('freeShippingThreshold')} />
          <div className="sm:col-span-2"><Checkbox label="Offer Cash on Delivery" {...form.register('codEnabled')} /></div>
          <Input label="COD limit per order (₹)" type="number" {...form.register('codMaxOrderValue')} />
          <Input label="Open COD orders per customer" type="number" {...form.register('codMaxOpenOrders')} />
        </Card>
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Online payments</h2>
          <Input label="Payment window (minutes)" type="number" hint="How long stock is reserved while the customer pays." {...form.register('paymentWindowMinutes')} />
          <Input label="Grace period (minutes)" type="number" hint="Extra time for slow UPI payments before the order expires." {...form.register('paymentGraceMinutes')} />
          <Alert tone="info" className="sm:col-span-2">For a live demo, set the window to 2 minutes and grace to 0 to watch an unpaid order expire and its stock return.</Alert>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Demo tools</h2>
          <p className="mt-1 text-sm text-stone-600">Simulate DemoPay being unreachable for the next online order, to show the order being saved and the customer retrying payment.</p>
          <Button className="mt-3" variant="outline" loading={outage.isPending} onClick={() => outage.mutate()}>Simulate gateway outage (next order)</Button>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- audit log

export function AdminAudit() {
  useDocumentTitle('Audit log');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin', 'audit', page, q], queryFn: () => request<{ data: AuditLogRow[]; meta: PageMeta }>(`/admin/audit-logs${qs({ page, q })}`) });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every admin change: who did what, and when." />
      <Input className="mb-4 w-full sm:w-72" placeholder="Filter by action (e.g. order, coupon)" aria-label="Filter" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.isPending ? <Skeleton className="h-64" /> : list.data.data.length === 0 ? <EmptyState title="No admin activity yet" /> : (
        <>
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {list.data.data.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-stone-500">{formatDateTime(a.createdAt)}</Td>
                  <Td>{a.actorName}</Td>
                  <Td><Badge>{a.action}</Badge></Td>
                  <Td className="font-mono text-xs">{a.entityType}/{a.entityId}</Td>
                  <Td className="max-w-sm truncate text-stone-600">{a.summary}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination meta={list.data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
