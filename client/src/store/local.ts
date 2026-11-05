import { MAX_CART_LINES, MAX_QTY_PER_LINE } from '@shop/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** localStorage can throw (private mode, blocked storage); fall back to memory. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export interface GuestItem {
  productId: string;
  variantId: string;
  quantity: number;
}

interface GuestCartState {
  items: GuestItem[];
  add: (item: GuestItem) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
}

export const useGuestCart = create<GuestCartState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) =>
        set((s) => {
          const existing = s.items.find((i) => i.variantId === item.variantId);
          if (existing) {
            return { items: s.items.map((i) => (i.variantId === item.variantId ? { ...i, quantity: Math.min(MAX_QTY_PER_LINE, i.quantity + item.quantity) } : i)) };
          }
          if (s.items.length >= MAX_CART_LINES) return s;
          return { items: [...s.items, item] };
        }),
      setQuantity: (variantId, quantity) => set((s) => ({ items: s.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)) })),
      remove: (variantId) => set((s) => ({ items: s.items.filter((i) => i.variantId !== variantId) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'storefront-guest-cart', storage: safeStorage },
  ),
);

interface RecentState {
  ids: string[];
  push: (id: string) => void;
}

export const useRecentlyViewed = create<RecentState>()(
  persist(
    (set) => ({
      ids: [],
      push: (id) => set((s) => ({ ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, 12) })),
    }),
    { name: 'storefront-recently-viewed', storage: safeStorage },
  ),
);

// ---------------------------------------------------------------- toasts

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast['kind'], message: string) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToasts.getState().push('success', m),
  error: (m: string) => useToasts.getState().push('error', m),
  info: (m: string) => useToasts.getState().push('info', m),
};
