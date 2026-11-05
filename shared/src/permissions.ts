import type { Role } from './enums';

export const PERMISSIONS = [
  'catalog:write',
  'inventory:write',
  'orders:write',
  'customers:write',
  'coupons:write',
  'reviews:moderate',
  'reports:read',
  'settings:write',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: [],
  admin: PERMISSIONS,
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isStaff(role: Role): boolean {
  return ROLE_PERMISSIONS[role].length > 0;
}
