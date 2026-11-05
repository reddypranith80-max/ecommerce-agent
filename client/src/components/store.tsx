import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, Inbox, LayoutDashboard, LogOut, Menu, Package, Search, ShoppingCart, Store, User, X } from 'lucide-react';
import type { ProductCard as Card } from '@shop/shared';
import { useCart, useCategories, useConfig, useSignOut, useToggleWishlist, useWishlistIds } from '../features/hooks';
import { formatINR, useDebounced } from '../lib/format';
import { api, qs } from '../services/api';
import { isAdmin, useSession } from '../store/session';
import { Badge, PriceTag, RatingStars, Skeleton, cx } from './ui';

// ---------------------------------------------------------------- layout

export function StoreLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DemoBanner />
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function DemoBanner() {
  return (
    <div className="bg-stone-900 px-4 py-2 text-center text-xs text-stone-200">
      <span className="font-semibold text-amber-300">Demo store</span> · payments use virtual money through the built-in DemoPay gateway — nothing is charged.{' '}
      <Link to="/demo/inbox" className="underline decoration-stone-500 underline-offset-2 hover:text-white">
        Open the demo inbox
      </Link>{' '}
      to see emails the store sends.
    </div>
  );
}

function Header() {
  const { user, status } = useSession();
  const { count } = useCart();
  const config = useConfig();
  const categories = useCategories();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-3">
        <button className="rounded-lg p-2 text-stone-700 hover:bg-stone-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-stone-900">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-700 text-white">
            <Store className="size-4" />
          </span>
          <span className="hidden sm:inline">{config.data?.storeName ?? 'Storefront Demo'}</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Categories">
          {categories.data?.map((c) => (
            <div key={c.id} className="group relative">
              <NavLink to={`/c/${c.slug}`} className={({ isActive }) => cx('rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100', isActive ? 'text-brand-700' : 'text-stone-700')}>
                {c.name}
              </NavLink>
              {c.children.length > 0 && (
                <div className="invisible absolute left-0 top-full z-50 min-w-48 rounded-xl border border-stone-200 bg-white p-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  {c.children.map((child) => (
                    <Link key={child.id} to={`/c/${child.slug}`} className="block rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
                      {child.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="ml-auto hidden max-w-sm flex-1 md:block">
          <SearchBox />
        </div>
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          {status === 'authenticated' && (
            <Link to="/wishlist" className="rounded-lg p-2 text-stone-700 hover:bg-stone-100" aria-label="Wishlist">
              <Heart className="size-5" />
            </Link>
          )}
          <Link to="/cart" className="relative rounded-lg p-2 text-stone-700 hover:bg-stone-100" aria-label={`Cart, ${count} items`}>
            <ShoppingCart className="size-5" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-brand-700 px-1 text-[11px] font-semibold text-white">{count}</span>
            )}
          </Link>
          {status === 'authenticated' && user ? (
            <AccountMenu />
          ) : status === 'loading' ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <Link to="/login" className="ml-1 rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <div className="container-page pb-3 md:hidden">
        <SearchBox />
      </div>
      {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} />}
    </header>
  );
}

function AccountMenu() {
  const user = useSession((s) => s.user)!;
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-50';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="ml-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100">
        <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{user.name[0]?.toUpperCase()}</span>
        <span className="hidden text-sm font-medium text-stone-800 xl:inline">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-stone-200 bg-white p-2 shadow-lg" onClick={() => setOpen(false)}>
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-stone-900">{user.name}</p>
            <p className="truncate text-xs text-stone-500">{user.email}</p>
          </div>
          <hr className="my-1 border-stone-100" />
          {isAdmin(user) && (
            <Link role="menuitem" to="/admin" className={item}>
              <LayoutDashboard className="size-4" /> Admin dashboard
            </Link>
          )}
          <Link role="menuitem" to="/orders" className={item}>
            <Package className="size-4" /> My orders
          </Link>
          <Link role="menuitem" to="/wishlist" className={item}>
            <Heart className="size-4" /> Wishlist
          </Link>
          <Link role="menuitem" to="/account" className={item}>
            <User className="size-4" /> Account & addresses
          </Link>
          <Link role="menuitem" to="/demo/inbox" className={item}>
            <Inbox className="size-4" /> Demo inbox
          </Link>
          <hr className="my-1 border-stone-100" />
          <button
            role="menuitem"
            className={item}
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const categories = useCategories();
  const { user } = useSession();
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-stone-900/40" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold">Menu</span>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-stone-100" aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <Link to="/products" className="rounded-lg px-3 py-2 font-medium hover:bg-stone-50">
          All products
        </Link>
        {categories.data?.map((c) => (
          <div key={c.id} className="mt-2">
            <Link to={`/c/${c.slug}`} className="block rounded-lg px-3 py-2 font-medium hover:bg-stone-50">
              {c.name}
            </Link>
            {c.children.map((child) => (
              <Link key={child.id} to={`/c/${child.slug}`} className="block rounded-lg px-6 py-1.5 text-sm text-stone-600 hover:bg-stone-50">
                {child.name}
              </Link>
            ))}
          </div>
        ))}
        <hr className="my-4 border-stone-100" />
        {user ? (
          <>
            {isAdmin(user) && <Link to="/admin" className="rounded-lg px-3 py-2 hover:bg-stone-50">Admin dashboard</Link>}
            <Link to="/orders" className="rounded-lg px-3 py-2 hover:bg-stone-50">My orders</Link>
            <Link to="/account" className="rounded-lg px-3 py-2 hover:bg-stone-50">Account</Link>
          </>
        ) : (
          <Link to="/login" className="rounded-lg px-3 py-2 hover:bg-stone-50">Sign in / Create account</Link>
        )}
        <Link to="/demo/inbox" className="rounded-lg px-3 py-2 hover:bg-stone-50">Demo inbox</Link>
      </div>
    </div>
  );
}

export function SearchBox() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 200);
  const listId = useId();
  const suggestions = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: () => api.get<{ name: string; slug: string; imageUrl: string | null }[]>(`/products/suggest${qs({ q: debounced })}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const items = debounced.length >= 2 ? (suggestions.data ?? []) : [];

  const submit = () => {
    setOpen(false);
    if (active >= 0 && items[active]) navigate(`/p/${items[active]!.slug}`);
    else if (q.trim()) navigate(`/products${qs({ q: q.trim() })}`);
  };

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search products, brands…"
        aria-label="Search products"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className="h-10 w-full rounded-full border border-stone-300 bg-stone-50 pl-9 pr-4 text-sm focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
          {items.map((s, i) => (
            <li
              id={`${listId}-${i}`}
              key={s.slug}
              role="option"
              aria-selected={i === active}
              onMouseDown={() => navigate(`/p/${s.slug}`)}
              className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === active ? 'bg-brand-50' : 'hover:bg-stone-50')}
            >
              {s.imageUrl && <img src={s.imageUrl} alt="" className="size-8 rounded-md object-cover" />}
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function Footer() {
  const config = useConfig();
  const links: [string, string][] = [
    ['/pages/about', 'About this demo'],
    ['/pages/shipping', 'Shipping'],
    ['/pages/returns', 'Cancellations & refunds'],
    ['/pages/privacy', 'Privacy'],
    ['/pages/terms', 'Terms'],
    ['/pages/contact', 'Contact'],
  ];
  return (
    <footer className="mt-16 border-t border-stone-200 bg-white">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-stone-900">{config.data?.storeName ?? 'Storefront Demo'}</p>
          <p className="mt-2 text-sm text-stone-500">A complete e-commerce demo: catalog, cart, checkout with virtual-money payments, order tracking and an admin dashboard.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          {links.map(([to, text]) => (
            <Link key={to} to={to} className="text-stone-600 hover:text-brand-700">
              {text}
            </Link>
          ))}
        </nav>
        <div className="text-sm text-stone-600">
          <p>Support: {config.data?.supportEmail}</p>
          <p className="mt-1">Free shipping over {formatINR(config.data?.freeShippingThreshold ?? 99900)}</p>
          <p className="mt-1">Prices include GST.</p>
        </div>
      </div>
      <div className="border-t border-stone-100 py-4 text-center text-xs text-stone-400">Demo only · no real payments, products or deliveries.</div>
    </footer>
  );
}

// ---------------------------------------------------------------- product cards

export function WishlistButton({ productId, className }: { productId: string; className?: string }) {
  const status = useSession((s) => s.status);
  const ids = useWishlistIds();
  const toggle = useToggleWishlist();
  const navigate = useNavigate();
  const on = Boolean(ids.data?.includes(productId));
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (status !== 'authenticated') {
          navigate(`/login?from=${encodeURIComponent(location.pathname)}`);
          return;
        }
        toggle.mutate({ productId, on: !on });
      }}
      aria-pressed={on}
      aria-label={on ? 'Remove from wishlist' : 'Save to wishlist'}
      className={cx('grid size-9 place-items-center rounded-full bg-white/90 shadow-sm ring-1 ring-stone-200 transition hover:scale-105', className)}
    >
      <Heart className={cx('size-4', on ? 'fill-rose-500 text-rose-500' : 'text-stone-600')} />
    </button>
  );
}

export function ProductCard({ product }: { product: Card }) {
  return (
    <Link to={`/p/${product.slug}`} className="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-square overflow-hidden bg-stone-100">
        {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" width={480} height={480} className="size-full object-cover transition duration-300 group-hover:scale-105" />}
        <WishlistButton productId={product.id} className="absolute right-2 top-2" />
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {product.maxDiscountPct > 0 && <Badge tone="green">{product.maxDiscountPct}% off</Badge>}
          {product.stockStatus === 'low_stock' && <Badge tone="amber">Only a few left</Badge>}
          {product.stockStatus === 'out_of_stock' && <Badge tone="stone">Out of stock</Badge>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand && <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{product.brand}</p>}
        <h3 className="line-clamp-2 text-sm font-medium text-stone-900">{product.name}</h3>
        {product.ratingCount > 0 && <RatingStars value={product.ratingAvg} count={product.ratingCount} />}
        <div className="mt-auto pt-1">
          <PriceTag price={product.priceMin} compareAt={product.compareAtPrice} size="sm" from={product.priceMax > product.priceMin} />
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, loading, count = 8 }: { products?: Card[]; loading?: boolean; count?: number }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <Skeleton className="aspect-square rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products?.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}

export function Rail({ title, link, products, loading }: { title: string; link?: string; products?: Card[]; loading?: boolean }) {
  if (!loading && (!products || products.length === 0)) return null;
  return (
    <section className="container-page mt-12">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
        {link && (
          <Link to={link} className="text-sm font-medium text-brand-700 hover:underline">
            View all
          </Link>
        )}
      </div>
      <ProductGrid products={products?.slice(0, 8)} loading={loading} count={4} />
    </section>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-stone-500">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>/</span>}
            {it.to ? (
              <Link to={it.to} className="hover:text-brand-700">
                {it.label}
              </Link>
            ) : (
              <span className="text-stone-800" aria-current="page">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
