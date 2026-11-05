import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Boxes,
  ChartColumn,
  ClipboardList,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Package,
  Settings,
  Store,
  Tag,
  Ticket,
  TriangleAlert,
  Undo2,
  Users,
  X,
  LayoutGrid,
} from 'lucide-react';
import { ORDER_STATUS_LABELS, type DashboardData } from '@shop/shared';
import { Card, ErrorState, OrderStatusBadge, PaymentStatusBadge, Skeleton, Table, Td, Th, cx, useDocumentTitle } from '../../components/ui';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import { api } from '../../services/api';
import { useSession } from '../../store/session';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Orders', icon: Package },
  { to: '/admin/products', label: 'Products', icon: Tag },
  { to: '/admin/categories', label: 'Categories', icon: LayoutGrid },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/coupons', label: 'Coupons', icon: Ticket },
  { to: '/admin/reviews', label: 'Reviews', icon: MessageSquare },
  { to: '/admin/refunds', label: 'Refunds', icon: Undo2 },
  { to: '/admin/reports', label: 'Reports', icon: ChartColumn },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit', label: 'Audit log', icon: ClipboardList },
];

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const user = useSession((s) => s.user);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const nav = (
    <nav className="space-y-0.5 p-3" aria-label="Admin">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-700 text-white' : 'text-stone-300 hover:bg-white/10 hover:text-white')}
        >
          <n.icon className="size-4" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-dvh bg-stone-100">
      <aside className="hidden w-60 shrink-0 bg-stone-900 lg:block">
        <Link to="/admin" className="flex h-16 items-center gap-2 px-5 font-semibold text-white">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-600"><Store className="size-4" /></span> Admin
        </Link>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-stone-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-stone-900">
            <div className="flex h-16 items-center justify-between px-5 text-white">
              <span className="font-semibold">Admin</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-stone-200 bg-white px-4 sm:px-6">
          <button className="rounded-lg p-2 hover:bg-stone-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Demo · virtual money</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link to="/" className="font-medium text-brand-700 hover:underline">View store</Link>
            <span className="hidden text-stone-500 sm:inline">{user?.email}</span>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- charts

export function BarChart({ data, format = (v) => String(v), height = 180 }: { data: { label: string; value: number }[]; format?: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Bar chart">
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return (
            <rect key={i} x={i * barW + barW * 0.15} y={height / 4 - h} width={barW * 0.7} height={Math.max(h, 0.3)} rx={0.6} className="fill-brand-600 hover:fill-brand-800">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, previous, format }: { label: string; value: number; previous: number; format: (v: number) => string }) {
  const change = previous === 0 ? null : Math.round(((value - previous) / previous) * 100);
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{format(value)}</p>
      {change === null ? (
        <p className="mt-1 text-xs text-stone-400">No data for the previous period</p>
      ) : (
        <p className={cx('mt-1 text-xs', change >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs previous period
        </p>
      )}
    </Card>
  );
}

const RANGES = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
] as const;

export function AdminDashboard() {
  useDocumentTitle('Admin dashboard');
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('30d');
  const dash = useQuery({ queryKey: ['admin', 'dashboard', range], queryFn: () => api.get<DashboardData>(`/admin/dashboard?range=${range}`), refetchInterval: 15_000 });
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1" role="tablist">
          {RANGES.map(([id, text]) => (
            <button key={id} role="tab" aria-selected={range === id} onClick={() => setRange(id)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', range === id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100')}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      ) : !dash.data ? (
        <div className="grid gap-4 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <DashboardBody d={dash.data} />
      )}
    </div>
  );
}

function DashboardBody({ d }: { d: DashboardData }) {
  const attention = [
    { n: d.attention.failedRefunds, text: 'refunds failed', to: '/admin/refunds?status=failed', tone: 'text-rose-700' },
    { n: d.attention.pendingRefunds, text: 'refunds in progress', to: '/admin/refunds', tone: 'text-violet-700' },
    { n: d.attention.needsReview, text: 'orders need review', to: '/admin/orders?needsReview=true', tone: 'text-amber-700' },
    { n: d.attention.lowStock, text: 'SKUs low on stock', to: '/admin/inventory?lowStock=true', tone: 'text-amber-700' },
    { n: d.awaitingFulfilment, text: 'orders to fulfil', to: '/admin/orders?status=confirmed', tone: 'text-sky-700' },
  ].filter((a) => a.n > 0);
  const maxStatus = Math.max(1, ...d.ordersByStatus.map((s) => s.count));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Gross sales" format={formatINR} {...d.kpis.grossSales} />
        <Kpi label="Net revenue" format={formatINR} {...d.kpis.netRevenue} />
        <Kpi label="Orders" format={String} {...d.kpis.orders} />
        <Kpi label="Avg. order value" format={formatINR} {...d.kpis.averageOrderValue} />
        <Kpi label="New customers" format={String} {...d.kpis.newCustomers} />
      </div>

      {attention.length > 0 && (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 border-amber-200 bg-amber-50 p-4">
          <span className="flex items-center gap-2 text-sm font-semibold text-amber-900"><TriangleAlert className="size-4" /> Needs attention</span>
          {attention.map((a) => (
            <Link key={a.text} to={a.to} className={cx('text-sm font-medium hover:underline', a.tone)}>
              {a.n} {a.text}
            </Link>
          ))}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Gross sales by day</h2>
            <span className="text-sm text-stone-500">{formatDate(d.range.from)} – {formatDate(d.range.to)}</span>
          </div>
          <BarChart data={d.series.map((p) => ({ label: p.date.slice(5), value: p.grossSales }))} format={formatINR} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Orders by status</h2>
          {d.ordersByStatus.length === 0 ? (
            <p className="text-sm text-stone-500">No orders in this period.</p>
          ) : (
            <ul className="space-y-2.5">
              {d.ordersByStatus.map((s) => (
                <li key={s.status} className="text-sm">
                  <div className="flex justify-between"><span>{ORDER_STATUS_LABELS[s.status]}</span><span className="font-medium">{s.count}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(s.count / maxStatus) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Top products</h2>
          {d.topProducts.length === 0 ? (
            <p className="text-sm text-stone-500">No sales yet.</p>
          ) : (
            <ol className="space-y-3">
              {d.topProducts.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 text-sm">
                  <span className="grid size-6 place-items-center rounded-full bg-stone-100 text-xs font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-stone-500">{p.units} sold</span>
                  <span className="font-medium">{formatINR(p.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="xl:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Latest orders</h2>
            <Link to="/admin/orders" className="text-sm text-brand-700 hover:underline">All orders</Link>
          </div>
          <Table>
            <thead>
              <tr><Th>Order</Th><Th>Customer</Th><Th>Status</Th><Th>Payment</Th><Th className="text-right">Total</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {d.latestOrders.map((o) => (
                <tr key={o.orderNumber} className="hover:bg-stone-50">
                  <Td><Link to={`/admin/orders/${o.orderNumber}`} className="font-medium text-brand-700 hover:underline">{o.orderNumber}</Link><p className="text-xs text-stone-500">{formatDateTime(o.createdAt)}</p></Td>
                  <Td>{o.customerName}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td><PaymentStatusBadge status={o.paymentStatus} /></Td>
                  <Td className="text-right font-medium">{formatINR(o.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
