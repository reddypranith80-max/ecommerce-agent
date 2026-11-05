import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, ShoppingCart, Trash2 } from 'lucide-react';
import { type ProductCard as Card, type PageMeta } from '@shop/shared';
import { ProductGrid } from '../components/store';
import { Alert, Badge, Button, ButtonLink, Card as Surface, EmptyState, ErrorState, PageHeader, Pagination, PriceTag, QuantityStepper, Skeleton, useDocumentTitle } from '../components/ui';
import { useCart, useConfig } from '../features/hooks';
import { formatINR } from '../lib/format';
import { request } from '../services/api';

export function CartPage() {
  useDocumentTitle('Your cart');
  const { cart, isLoading, isError, error, refetch, update, remove, signedIn } = useCart();
  const config = useConfig();
  const navigate = useNavigate();

  if (isError) return <div className="container-page py-10"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (isLoading || !cart) {
    return (
      <div className="container-page grid gap-6 py-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (cart.items.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState icon={<ShoppingCart className="size-10" />} title="Your cart is empty" action={<ButtonLink to="/products">Start shopping</ButtonLink>}>
          Items you add will show up here{signedIn ? '' : ' — even before you sign in'}.
        </EmptyState>
      </div>
    );
  }

  const blocking = cart.items.some((l) => l.issues.length > 0);
  const threshold = config.data?.freeShippingThreshold ?? 99900;
  const shipping = cart.subtotal >= threshold ? 0 : (config.data?.shippingFlatFee ?? 4900);
  const toFree = threshold - cart.subtotal;

  return (
    <div className="container-page py-8">
      <PageHeader title="Your cart" subtitle={`${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <ul className="space-y-3">
          {cart.items.map((line) => (
            <li key={line.id} className="flex gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <Link to={`/p/${line.slug}`} className="size-24 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                {line.imageUrl && <img src={line.imageUrl} alt="" className="size-full object-cover" />}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/p/${line.slug}`} className="line-clamp-2 font-medium text-stone-900 hover:text-brand-700">
                      {line.name}
                    </Link>
                    {line.variantLabel && <p className="text-sm text-stone-500">{line.variantLabel}</p>}
                  </div>
                  <p className="shrink-0 font-semibold">{formatINR(line.lineTotal)}</p>
                </div>
                <PriceTag price={line.unitPrice} compareAt={line.compareAtPrice} size="sm" />
                {line.warnings.includes('price_changed') && line.previousUnitPrice !== null && (
                  <p className="text-xs text-amber-700">Price changed from {formatINR(line.previousUnitPrice)} since you added it.</p>
                )}
                {line.issues.includes('unavailable') && <Badge tone="red">No longer available — please remove</Badge>}
                {line.issues.includes('out_of_stock') && <Badge tone="red">Out of stock</Badge>}
                {line.issues.includes('insufficient_stock') && <Badge tone="amber">Only {line.available} left — reduce the quantity</Badge>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <QuantityStepper
                    value={line.quantity}
                    max={Math.max(line.quantity, Math.min(10, line.available || line.quantity))}
                    disabled={update.isPending || line.issues.includes('unavailable')}
                    onChange={(q) => update.mutate({ line, quantity: q })}
                  />
                  <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => remove.mutate(line)} aria-label={`Remove ${line.name}`}>
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Surface className="h-fit p-5 lg:sticky lg:top-24">
          <h2 className="text-base font-semibold text-stone-900">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-600">Subtotal</dt>
              <dd>{formatINR(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-stone-600">Shipping (estimate)</dt>
              <dd>{shipping === 0 ? 'Free' : formatINR(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold">
              <dt>Estimated total</dt>
              <dd>{formatINR(cart.subtotal + shipping)}</dd>
            </div>
          </dl>
          {toFree > 0 && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-stone-100">
                <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (cart.subtotal / threshold) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-stone-500">Add {formatINR(toFree)} more for free shipping.</p>
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">Coupons are applied at checkout. Prices include GST.</p>
          {blocking && <Alert tone="warning" className="mt-3">Fix the highlighted items to continue.</Alert>}
          <Button size="lg" className="mt-4 w-full" disabled={blocking} onClick={() => navigate(signedIn ? '/checkout' : '/login?from=/checkout')}>
            {signedIn ? 'Proceed to checkout' : 'Sign in to check out'}
          </Button>
          <Link to="/products" className="mt-3 block text-center text-sm text-brand-700 hover:underline">
            Continue shopping
          </Link>
        </Surface>
      </div>
    </div>
  );
}

export function WishlistPage() {
  useDocumentTitle('Wishlist');
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['wishlist', page], queryFn: () => request<{ data: Card[]; meta: PageMeta }>(`/wishlist?page=${page}`) });
  const [, force] = useState(0);
  return (
    <div className="container-page py-8">
      <PageHeader title="Your wishlist" subtitle="Products you have saved for later." />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <ProductGrid loading count={4} />
      ) : list.data.data.length === 0 ? (
        <EmptyState icon={<Heart className="size-10" />} title="Nothing saved yet" action={<ButtonLink to="/products">Browse products</ButtonLink>}>
          Tap the heart on any product to save it here.
        </EmptyState>
      ) : (
        <>
          <ProductGrid products={list.data.data} />
          <Pagination meta={list.data.meta} onPage={(p) => { setParams({ page: String(p) }); force((x) => x + 1); }} />
        </>
      )}
    </div>
  );
}
