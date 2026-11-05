import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Package, ShieldCheck, SlidersHorizontal, Star, Truck, Undo2, Wallet } from 'lucide-react';
import {
  PRODUCT_SORTS,
  reviewSchema,
  type CategoryNode,
  type PageMeta,
  type ProductCard as Card,
  type ProductDetail,
  type Review,
  type ReviewEligibility,
  type ReviewSummary,
} from '@shop/shared';
import { Breadcrumbs, ProductGrid, Rail, WishlistButton } from '../components/store';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  PriceTag,
  QuantityStepper,
  RatingStars,
  Select,
  Skeleton,
  Spinner,
  Textarea,
  cx,
  useDocumentTitle,
} from '../components/ui';
import { useCart, useCategories, useConfig, useHome, useProduct, useProducts, useRecommended } from '../features/hooks';
import { formatDate, formatINR, label } from '../lib/format';
import { api, errorMessage, qs, request } from '../services/api';
import { toast, useRecentlyViewed } from '../store/local';
import { useSession } from '../store/session';

// ---------------------------------------------------------------- home

export function HomePage() {
  useDocumentTitle('');
  const home = useHome();
  const recommended = useRecommended();
  const recentIds = useRecentlyViewed((s) => s.ids);
  const recent = useQuery({
    queryKey: ['cards', recentIds],
    queryFn: () => api.post<Card[]>('/products/cards', { ids: recentIds }),
    enabled: recentIds.length > 0,
  });

  if (home.isError) return <div className="container-page py-10"><ErrorState error={home.error} onRetry={() => home.refetch()} /></div>;
  const data = home.data;
  return (
    <div>
      <section className="bg-gradient-to-br from-brand-800 via-brand-700 to-teal-600 text-white">
        <div className="container-page grid items-center gap-8 py-14 md:grid-cols-2 md:py-20">
          <div>
            <Badge tone="amber" className="mb-4">Virtual money · try everything</Badge>
            {data ? (
              <>
                <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">{data.hero.title}</h1>
                <p className="mt-4 max-w-xl text-base text-brand-50/90 sm:text-lg">{data.hero.subtitle}</p>
              </>
            ) : (
              <>
                <Skeleton className="h-12 w-4/5 bg-white/20" />
                <Skeleton className="mt-4 h-6 w-3/5 bg-white/20" />
              </>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/products" className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 font-medium text-brand-800 shadow hover:bg-brand-50">
                Shop the collection <ArrowRight className="size-4" />
              </Link>
              <Link to="/products?sort=popular" className="inline-flex h-12 items-center rounded-lg px-6 font-medium text-white ring-1 ring-white/40 hover:bg-white/10">
                Best sellers
              </Link>
            </div>
          </div>
          <div className="hidden grid-cols-2 gap-3 md:grid">
            {(data?.featured ?? []).slice(0, 4).map((p, i) => (
              <Link key={p.id} to={`/p/${p.slug}`} className={cx('overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/20 transition hover:scale-[1.02]', i % 2 === 1 && 'translate-y-6')}>
                {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="aspect-square w-full object-cover" />}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container-page -mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { icon: Truck, t: 'Free shipping', d: 'on orders over ₹999' },
          { icon: Wallet, t: 'COD or DemoPay', d: 'virtual money only' },
          { icon: Undo2, t: 'Easy cancellation', d: 'auto-refund before dispatch' },
          { icon: ShieldCheck, t: 'Verified reviews', d: 'from real buyers' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <Icon className="size-6 shrink-0 text-brand-700" />
            <div>
              <p className="text-sm font-semibold text-stone-900">{t}</p>
              <p className="text-xs text-stone-500">{d}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="container-page mt-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Shop by category</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(data?.categories ?? Array.from({ length: 4 }, () => null)).map((c, i) =>
            c ? (
              <Link key={c.id} to={`/c/${c.slug}`} className="group overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                {c.imageUrl && <img src={c.imageUrl} alt="" className="aspect-[4/3] w-full object-cover transition group-hover:scale-105" />}
                <p className="px-4 py-3 font-medium text-stone-900">{c.name}</p>
              </Link>
            ) : (
              <Skeleton key={i} className="aspect-[4/3]" />
            ),
          )}
        </div>
      </section>

      <Rail title="Featured" products={data?.featured} loading={!data} link="/products" />
      <Rail title="Deals of the week" products={data?.offers} loading={!data} />
      {recommended.data && recommended.data.length > 0 && <Rail title="Recommended for you" products={recommended.data} />}
      <Rail title="Trending now" products={data?.trending} loading={!data} link="/products?sort=popular" />
      <Rail title="New arrivals" products={data?.newArrivals} loading={!data} link="/products?sort=newest" />
      {recent.data && recent.data.length > 0 && <Rail title="Recently viewed" products={recent.data} />}
    </div>
  );
}

// ---------------------------------------------------------------- listing

const SORT_LABELS: Record<(typeof PRODUCT_SORTS)[number], string> = {
  relevance: 'Best match',
  newest: 'Newest first',
  popular: 'Most popular',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Top rated',
};

function findCategory(nodes: CategoryNode[] | undefined, slug: string | undefined): CategoryNode | undefined {
  for (const n of nodes ?? []) {
    if (n.slug === slug) return n;
    const child = findCategory(n.children, slug);
    if (child) return child;
  }
  return undefined;
}

export function ProductsPage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const categories = useCategories();
  const category = findCategory(categories.data, slug ?? params.get('category') ?? undefined);
  const q = params.get('q') ?? undefined;
  const page = Number(params.get('page') ?? 1);
  const minRupees = params.get('min') ?? '';
  const maxRupees = params.get('max') ?? '';
  const query = {
    q,
    category: slug ?? params.get('category') ?? undefined,
    minPrice: minRupees ? Math.round(Number(minRupees) * 100) : undefined,
    maxPrice: maxRupees ? Math.round(Number(maxRupees) * 100) : undefined,
    rating: params.get('rating') ?? undefined,
    inStock: params.get('inStock') === 'true' ? true : undefined,
    sort: params.get('sort') ?? undefined,
    page,
    limit: 24,
  };
  const products = useProducts(query);
  const title = q ? `Results for “${q}”` : (category?.name ?? 'All products');
  useDocumentTitle(title);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const [minDraft, setMinDraft] = useState(minRupees);
  const [maxDraft, setMaxDraft] = useState(maxRupees);
  useEffect(() => {
    setMinDraft(minRupees);
    setMaxDraft(maxRupees);
  }, [minRupees, maxRupees]);

  const filters = (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Category</h3>
        <ul className="space-y-1 text-sm">
          <li>
            <Link to={`/products${qs({ q })}`} className={cx('block rounded-md px-2 py-1 hover:bg-stone-100', !category && 'font-semibold text-brand-700')}>
              All products
            </Link>
          </li>
          {categories.data?.map((c) => (
            <li key={c.id}>
              <Link to={`/c/${c.slug}${qs({ q })}`} className={cx('block rounded-md px-2 py-1 hover:bg-stone-100', category?.id === c.id && 'font-semibold text-brand-700')}>
                {c.name}
              </Link>
              <ul className="ml-3 border-l border-stone-200 pl-2">
                {c.children.map((child) => (
                  <li key={child.id}>
                    <Link to={`/c/${child.slug}${qs({ q })}`} className={cx('block rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100', category?.id === child.id && 'font-semibold text-brand-700')}>
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ min: minDraft || undefined, max: maxDraft || undefined });
        }}
      >
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Price (₹)</h3>
        <div className="flex items-center gap-2">
          <Input aria-label="Minimum price" type="number" min={0} placeholder="Min" value={minDraft} onChange={(e) => setMinDraft(e.target.value)} />
          <span className="text-stone-400">–</span>
          <Input aria-label="Maximum price" type="number" min={0} placeholder="Max" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)} />
        </div>
        {products.data && products.data.meta.priceBounds.max > 0 && (
          <p className="mt-1 text-xs text-stone-500">
            Range {formatINR(products.data.meta.priceBounds.min)} – {formatINR(products.data.meta.priceBounds.max)}
          </p>
        )}
        <Button type="submit" variant="outline" size="sm" className="mt-2 w-full">
          Apply price
        </Button>
      </form>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Customer rating</h3>
        <div className="space-y-1">
          {[4, 3, 2].map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="rating" className="accent-brand-700" checked={params.get('rating') === String(r)} onChange={() => update({ rating: String(r) })} />
              <RatingStars value={r} /> & up
            </label>
          ))}
          {params.get('rating') && (
            <button className="text-xs text-brand-700 hover:underline" onClick={() => update({ rating: undefined })}>
              Clear rating
            </button>
          )}
        </div>
      </div>
      <Checkbox label="In stock only" checked={params.get('inStock') === 'true'} onChange={(e) => update({ inStock: e.target.checked ? 'true' : undefined })} />
    </div>
  );

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, ...(category ? [{ label: 'Products', to: '/products' }, { label: category.name }] : [{ label: 'Products' }])]} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
          <p className="mt-1 text-sm text-stone-500">{products.data ? `${products.data.meta.total} products` : 'Loading…'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="lg:hidden" icon={<SlidersHorizontal className="size-4" />} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
            Filters
          </Button>
          <Select aria-label="Sort by" value={params.get('sort') ?? (q ? 'relevance' : 'newest')} onChange={(e) => update({ sort: e.target.value })}>
            {PRODUCT_SORTS.filter((s) => s !== 'relevance' || q).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className={cx('rounded-xl border border-stone-200 bg-white p-4 lg:block lg:border-0 lg:bg-transparent lg:p-0', filtersOpen ? 'block' : 'hidden')} aria-label="Filters">
          {filters}
        </aside>
        <div>
          {products.isError ? (
            <ErrorState error={products.error} onRetry={() => products.refetch()} />
          ) : products.isPending ? (
            <ProductGrid loading />
          ) : products.data.data.length === 0 ? (
            <EmptyState icon={<Package className="size-10" />} title="No products match" action={<ButtonLink to="/products" variant="outline">Clear filters</ButtonLink>}>
              Try a different word, a wider price range, or remove a filter.
            </EmptyState>
          ) : (
            <div className={cx(products.isFetching && 'opacity-60 transition-opacity')}>
              <ProductGrid products={products.data.data} />
              <Pagination meta={products.data.meta} onPage={(p) => update({ page: String(p) })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- product detail

function useVariantPicker(product: ProductDetail | undefined) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!product) return;
    const first = product.variants.find((v) => v.inStock) ?? product.variants[0];
    setSelected(first ? { ...first.optionValues } : {});
  }, [product]);
  const matches = (ov: Record<string, string>, sel: Record<string, string>) => Object.entries(sel).every(([k, v]) => ov[k] === v);
  const variant = product?.variants.find((v) => matches(v.optionValues, selected) && Object.keys(v.optionValues).length === Object.keys(selected).length);
  const state = (option: string, value: string): 'available' | 'out' | 'none' => {
    const candidate = { ...selected, [option]: value };
    const found = product?.variants.filter((v) => matches(v.optionValues, candidate)) ?? [];
    if (found.length === 0) return 'none';
    return found.some((v) => v.inStock) ? 'available' : 'out';
  };
  return { selected, setSelected, variant, state };
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const product = useProduct(slug);
  const { add } = useCart();
  const navigate = useNavigate();
  const pushRecent = useRecentlyViewed((s) => s.push);
  const picker = useVariantPicker(product.data);
  const [qty, setQty] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const related = useQuery({ queryKey: ['related', slug], queryFn: () => api.get<Card[]>(`/products/${slug}/related`), enabled: Boolean(product.data) });
  useDocumentTitle(product.data?.name ?? 'Product');

  useEffect(() => {
    if (product.data) pushRecent(product.data.id);
    setImageIndex(0);
    setQty(1);
  }, [product.data, pushRecent]);

  if (product.isPending) {
    return (
      <div className="container-page grid gap-8 py-8 md:grid-cols-2">
        <Skeleton className="aspect-square" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  if (product.isError) {
    return (
      <div className="container-page py-10">
        <ErrorState error={product.error} onRetry={() => product.refetch()} />
      </div>
    );
  }
  const p = product.data;
  const v = picker.variant;
  const image = p.images[imageIndex] ?? p.images[0];

  return (
    <div className="container-page py-8">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, ...p.breadcrumb.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: p.name }]} />
      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        <div>
          <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {image ? <img src={image.url} alt={image.alt} width={image.width} height={image.height} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-stone-100" />}
            <WishlistButton productId={p.id} className="absolute right-3 top-3 size-10" />
          </div>
          {p.images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {p.images.map((img, i) => (
                <button key={img.mediaId} onClick={() => setImageIndex(i)} aria-label={`Show image ${i + 1}`} className={cx('size-20 shrink-0 overflow-hidden rounded-lg border-2', i === imageIndex ? 'border-brand-600' : 'border-transparent')}>
                  <img src={img.thumbUrl} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {p.brand && <p className="text-sm font-medium uppercase tracking-wide text-stone-500">{p.brand}</p>}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">{p.name}</h1>
          {p.ratingCount > 0 && (
            <a href="#reviews" className="mt-2 inline-flex items-center gap-2 text-sm text-stone-600 hover:text-brand-700">
              <RatingStars value={p.ratingAvg} /> {p.ratingAvg.toFixed(1)} · {p.ratingCount} reviews
            </a>
          )}
          <div className="mt-4">
            <PriceTag price={v?.price ?? p.priceMin} compareAt={v ? v.compareAtPrice : p.compareAtPrice} size="lg" />
            <p className="mt-1 text-xs text-stone-500">Inclusive of all taxes</p>
          </div>

          {p.options.map((opt) => (
            <fieldset key={opt.name} className="mt-6">
              <legend className="mb-2 text-sm font-medium text-stone-900">
                {opt.name}: <span className="font-normal text-stone-600">{picker.selected[opt.name]}</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {opt.values.map((val) => {
                  const st = picker.state(opt.name, val);
                  const active = picker.selected[opt.name] === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      disabled={st === 'none'}
                      onClick={() => picker.setSelected((s) => ({ ...s, [opt.name]: val }))}
                      aria-pressed={active}
                      className={cx(
                        'min-w-12 rounded-lg border px-3 py-2 text-sm transition',
                        active ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-stone-300 bg-white hover:border-stone-400',
                        st === 'out' && 'text-stone-400 line-through',
                        st === 'none' && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="mt-6">
            {!v ? (
              <Alert tone="warning">That combination is not available.</Alert>
            ) : !v.inStock ? (
              <Badge tone="stone">Out of stock</Badge>
            ) : v.available <= 5 ? (
              <Badge tone="amber">Only {v.available} left</Badge>
            ) : (
              <Badge tone="green">In stock</Badge>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <QuantityStepper value={qty} onChange={setQty} max={Math.max(1, Math.min(10, v?.available ?? 1))} disabled={!v?.inStock} />
            <Button
              size="lg"
              className="flex-1 sm:flex-none"
              disabled={!v?.inStock}
              loading={add.isPending}
              onClick={() =>
                v &&
                add.mutate(
                  { productId: p.id, variantId: v.id, quantity: qty },
                  { onSuccess: () => toast.success(`Added ${qty} × ${p.name} to your cart`) },
                )
              }
            >
              Add to cart
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={!v?.inStock}
              onClick={() =>
                v &&
                add.mutate({ productId: p.id, variantId: v.id, quantity: qty }, { onSuccess: () => navigate('/cart') })
              }
            >
              Buy now
            </Button>
          </div>
          {v && <p className="mt-2 text-xs text-stone-400">SKU {v.sku}</p>}

          <div className="mt-8 space-y-3 text-sm leading-relaxed text-stone-700">
            <h2 className="text-base font-semibold text-stone-900">About this product</h2>
            <p className="whitespace-pre-line">{p.description}</p>
            {p.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {p.tags.map((t) => (
                  <Link key={t} to={`/products${qs({ q: t })}`}>
                    <Badge>#{t}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Reviews slug={slug} />
      <Rail title="You might also like" products={related.data} />
    </div>
  );
}

// ---------------------------------------------------------------- reviews

function Reviews({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'newest' | 'highest' | 'lowest'>('newest');
  const signedIn = useSession((s) => s.status === 'authenticated');
  const reviews = useQuery({
    queryKey: ['reviews', slug, page, sort],
    queryFn: () => request<{ data: Review[]; meta: PageMeta; summary: ReviewSummary }>(`/products/${slug}/reviews${qs({ page, sort })}`),
  });
  const eligibility = useQuery({
    queryKey: ['review-eligibility', slug],
    queryFn: () => api.get<ReviewEligibility>(`/products/${slug}/reviews/eligibility`),
    enabled: signedIn,
  });

  return (
    <section id="reviews" className="mt-14 scroll-mt-24">
      <h2 className="mb-4 text-xl font-semibold tracking-tight text-stone-900">Ratings & reviews</h2>
      {reviews.isPending ? (
        <Spinner />
      ) : reviews.isError ? (
        <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <p className="text-4xl font-semibold">{reviews.data.summary.ratingAvg.toFixed(1)}</p>
            <RatingStars value={reviews.data.summary.ratingAvg} size="md" />
            <p className="mt-1 text-sm text-stone-500">{reviews.data.summary.ratingCount} verified reviews</p>
            <div className="mt-4 space-y-1.5">
              {(['5', '4', '3', '2', '1'] as const).map((r) => {
                const n = reviews.data.summary.distribution[r];
                const pct = reviews.data.summary.ratingCount ? (n / reviews.data.summary.ratingCount) * 100 : 0;
                return (
                  <div key={r} className="flex items-center gap-2 text-xs">
                    <span className="w-3">{r}</span>
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <div className="h-2 flex-1 rounded-full bg-stone-100">
                      <div className="h-2 rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 text-right text-stone-500">{n}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-5">
              {!signedIn ? (
                <p className="text-sm text-stone-500">
                  <Link to={`/login?from=/p/${slug}`} className="font-medium text-brand-700 hover:underline">Sign in</Link> to review products you have received.
                </p>
              ) : eligibility.data?.canReview ? (
                <ReviewForm slug={slug} />
              ) : eligibility.data?.reason === 'already_reviewed' ? (
                <p className="text-sm text-stone-500">Thanks — you have reviewed this product.</p>
              ) : eligibility.data ? (
                <p className="text-sm text-stone-500">Only customers who received this product can review it.</p>
              ) : null}
            </div>
          </div>
          <div>
            {reviews.data.data.length === 0 ? (
              <EmptyState title="No reviews yet">Reviews appear here once buyers have received the product.</EmptyState>
            ) : (
              <>
                <div className="mb-3 flex justify-end">
                  <Select aria-label="Sort reviews" value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}>
                    <option value="newest">Newest</option>
                    <option value="highest">Highest rating</option>
                    <option value="lowest">Lowest rating</option>
                  </Select>
                </div>
                <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
                  {reviews.data.data.map((r) => (
                    <li key={r.id} className="p-5">
                      <div className="flex items-center gap-2">
                        <RatingStars value={r.rating} />
                        <span className="text-sm font-semibold text-stone-900">{r.title}</span>
                      </div>
                      <p className="mt-2 text-sm text-stone-700">{r.body}</p>
                      <p className="mt-2 text-xs text-stone-500">
                        {r.authorName} · {formatDate(r.createdAt)} · <span className="text-emerald-700">Verified purchase</span>
                      </p>
                    </li>
                  ))}
                </ul>
                <Pagination meta={reviews.data.meta} onPage={setPage} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewForm({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const form = useForm({ resolver: zodResolver(reviewSchema), defaultValues: { rating: 5, title: '', body: '' } });
  const submit = useMutation({
    mutationFn: (body: { rating: number; title: string; body: string }) => api.post(`/products/${slug}/reviews`, body),
    onSuccess: () => {
      toast.success('Thanks for your review!');
      void qc.invalidateQueries({ queryKey: ['reviews', slug] });
      void qc.invalidateQueries({ queryKey: ['review-eligibility', slug] });
      void qc.invalidateQueries({ queryKey: ['product', slug] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-3">
      <p className="text-sm font-medium text-stone-900">Write a review</p>
      <Controller
        control={form.control}
        name="rating"
        render={({ field }) => (
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={field.value === i} aria-label={`${i} stars`} onClick={() => field.onChange(i)}>
                <Star className={cx('size-6', i <= field.value ? 'fill-amber-400 text-amber-400' : 'text-stone-300')} />
              </button>
            ))}
          </div>
        )}
      />
      <Input placeholder="Title" {...form.register('title')} error={form.formState.errors.title?.message} />
      <Textarea placeholder="What did you like or dislike?" rows={3} {...form.register('body')} error={form.formState.errors.body?.message} />
      <Button type="submit" size="sm" loading={submit.isPending}>
        Submit review
      </Button>
    </form>
  );
}

export const sortLabel = (s: string) => SORT_LABELS[s as keyof typeof SORT_LABELS] ?? label(s);
export { useConfig };
