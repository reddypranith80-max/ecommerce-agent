import type { PageMeta } from '@shop/shared';

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}
