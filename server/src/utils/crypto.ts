import { createHash, randomBytes, randomInt } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ORD-YYMMDD-XXXXXX with 6 random Crockford base32 characters (unique index + retry on collision). */
export function generateOrderNumber(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const date = ist.toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += CROCKFORD[randomInt(CROCKFORD.length)];
  return `ORD-${date}-${suffix}`;
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
