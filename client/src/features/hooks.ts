import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Address,
  AuthResult,
  Cart,
  CartLine,
  CategoryNode,
  HomeData,
  ProductCard,
  ProductDetail,
  ProductListResponse,
  PublicConfig,
} from '@shop/shared';
import { api, broadcastLogout, qs, request } from '../services/api';
import { toast, useGuestCart } from '../store/local';
import { useSession } from '../store/session';

export const keys = {
  config: ['config'] as const,
  home: ['home'] as const,
  recommended: ['home', 'recommended'] as const,
  categories: ['categories'] as const,
  products: (params: Record<string, unknown>) => ['products', params] as const,
  product: (slug: string) => ['product', slug] as const,
  cart: ['cart'] as const,
  guestCart: (items: unknown) => ['cart', 'guest', items] as const,
  wishlistIds: ['wishlist', 'ids'] as const,
  wishlist: (page: number) => ['wishlist', page] as const,
  addresses: ['addresses'] as const,
  orders: (params: Record<string, unknown>) => ['orders', params] as const,
  order: (no: string) => ['order', no] as const,
};

// ---------------------------------------------------------------- catalog

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api.get<PublicConfig>('/config'), staleTime: 5 * 60_000 });
export const useHome = () => useQuery({ queryKey: keys.home, queryFn: () => api.get<HomeData>('/home'), staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api.get<CategoryNode[]>('/categories'), staleTime: 5 * 60_000 });

export function useRecommended() {
  const signedIn = useSession((s) => s.status === 'authenticated');
  return useQuery({ queryKey: keys.recommended, queryFn: () => api.get<ProductCard[]>('/home/recommended'), enabled: signedIn });
}

export function useProducts(params: Record<string, string | number | boolean | undefined>) {
  return useQuery({
    queryKey: keys.products(params),
    queryFn: ({ signal }) => request<ProductListResponse>(`/products${qs(params)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export const useProduct = (slug: string) =>
  useQuery({ queryKey: keys.product(slug), queryFn: () => api.get<ProductDetail>(`/products/${encodeURIComponent(slug)}`) });

// ---------------------------------------------------------------- cart (server cart when signed in, browser cart for guests)

export function useCart() {
  const qc = useQueryClient();
  const signedIn = useSession((s) => s.status === 'authenticated');
  const guest = useGuestCart();

  const server = useQuery({ queryKey: keys.cart, queryFn: () => api.get<Cart>('/cart'), enabled: signedIn });
  const guestQuery = useQuery({
    queryKey: keys.guestCart(guest.items),
    queryFn: () => api.post<Cart>('/cart/preview', { items: guest.items }),
    enabled: !signedIn && guest.items.length > 0,
    placeholderData: keepPreviousData,
  });

  const setCart = (cart: Cart) => qc.setQueryData(keys.cart, cart);
  const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not update your cart.');

  const add = useMutation({
    mutationFn: async (input: { productId: string; variantId: string; quantity: number }) => {
      if (!signedIn) {
        guest.add(input);
        return null;
      }
      return api.post<Cart>('/cart/items', input);
    },
    onSuccess: (cart) => {
      if (cart) setCart(cart);
    },
    onError,
  });

  const update = useMutation({
    mutationFn: async ({ line, quantity }: { line: CartLine; quantity: number }) => {
      if (!signedIn) {
        guest.setQuantity(line.variantId, quantity);
        return null;
      }
      return api.patch<Cart>(`/cart/items/${line.id}`, { quantity });
    },
    onSuccess: (cart) => {
      if (cart) setCart(cart);
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: async (line: CartLine) => {
      if (!signedIn) {
        guest.remove(line.variantId);
        return null;
      }
      const res = await request<{ data: Cart }>(`/cart/items/${line.id}`, { method: 'DELETE' });
      return res.data;
    },
    onSuccess: (cart) => {
      if (cart) setCart(cart);
    },
    onError,
  });

  const empty: Cart = { items: [], subtotal: 0, itemCount: 0 };
  const query = signedIn ? server : guestQuery;
  const cart = signedIn ? server.data : guest.items.length === 0 ? empty : guestQuery.data;
  return {
    cart,
    isLoading: signedIn ? server.isPending : guest.items.length > 0 && guestQuery.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    count: signedIn ? (server.data?.itemCount ?? 0) : guest.items.reduce((s, i) => s + i.quantity, 0),
    add,
    update,
    remove,
    signedIn,
  };
}

// ---------------------------------------------------------------- wishlist

export function useWishlistIds() {
  const signedIn = useSession((s) => s.status === 'authenticated');
  return useQuery({ queryKey: keys.wishlistIds, queryFn: () => api.get<string[]>('/wishlist/ids'), enabled: signedIn, staleTime: 60_000 });
}

export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, on }: { productId: string; on: boolean }) => {
      if (on) await api.put(`/wishlist/${productId}`);
      else await api.del(`/wishlist/${productId}`);
      return { productId, on };
    },
    onMutate: async ({ productId, on }) => {
      const prev = qc.getQueryData<string[]>(keys.wishlistIds) ?? [];
      qc.setQueryData(keys.wishlistIds, on ? [...new Set([...prev, productId])] : prev.filter((id) => id !== productId));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx) qc.setQueryData(keys.wishlistIds, ctx.prev);
      toast.error(e instanceof Error ? e.message : 'Could not update your wishlist.');
    },
    onSuccess: ({ on }) => {
      toast.success(on ? 'Saved to your wishlist' : 'Removed from your wishlist');
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });
}

// ---------------------------------------------------------------- account

export const useAddresses = () => {
  const signedIn = useSession((s) => s.status === 'authenticated');
  return useQuery({ queryKey: keys.addresses, queryFn: () => api.get<Address[]>('/me/addresses'), enabled: signedIn });
};

/** Signs in, then merges anything the visitor put in the cart while signed out. */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mode, body }: { mode: 'login' | 'register'; body: Record<string, string> }) => {
      const result = await api.post<AuthResult>(mode === 'login' ? '/auth/login' : '/auth/register', body);
      useSession.getState().setSession(result.user, result.accessToken);
      const guestItems = useGuestCart.getState().items;
      if (guestItems.length > 0) {
        try {
          const merged = await api.post<{ cart: Cart; notMerged: unknown[] }>('/cart/merge', { items: guestItems });
          useGuestCart.getState().clear();
          qc.setQueryData(keys.cart, merged.cart);
          if (merged.notMerged.length > 0) toast.info(`${merged.notMerged.length} item(s) from your basket are no longer available.`);
        } catch {
          toast.error('We could not move your basket items to your account.');
        }
      }
      await qc.invalidateQueries();
      return result;
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    try {
      await request('/auth/logout', { method: 'POST', body: {}, headers: { 'X-Requested-With': 'fetch' } });
    } finally {
      useSession.getState().clear();
      broadcastLogout();
      qc.clear();
      toast.info('You are signed out.');
    }
  };
}
