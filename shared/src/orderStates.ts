import type { OrderStatus } from './enums';

export type ActorType = 'customer' | 'admin' | 'system';

interface Transition {
  to: OrderStatus;
  by: readonly ActorType[];
}

/** The single source of truth for which order status changes are allowed and by whom. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly Transition[]> = {
  pending_payment: [
    { to: 'confirmed', by: ['system'] },
    { to: 'expired', by: ['system'] },
    { to: 'cancelled', by: ['customer', 'admin', 'system'] },
  ],
  confirmed: [
    { to: 'processing', by: ['admin'] },
    { to: 'cancelled', by: ['customer', 'admin', 'system'] },
  ],
  processing: [
    { to: 'shipped', by: ['admin'] },
    { to: 'cancelled', by: ['admin'] },
  ],
  shipped: [
    { to: 'delivered', by: ['admin'] },
    { to: 'undelivered', by: ['admin'] },
  ],
  delivered: [],
  cancelled: [],
  expired: [],
  undelivered: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: ActorType): boolean {
  return ORDER_TRANSITIONS[from].some((t) => t.to === to && t.by.includes(actor));
}

export function allowedTransitions(from: OrderStatus, actor: ActorType): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((t) => t.by.includes(actor)).map((t) => t.to);
}

export function isCancellableBy(from: OrderStatus, actor: ActorType): boolean {
  return canTransition(from, 'cancelled', actor);
}

/** Display order of the happy path, used by the tracking timeline. */
export const ORDER_PROGRESS: readonly OrderStatus[] = ['confirmed', 'processing', 'shipped', 'delivered'];
