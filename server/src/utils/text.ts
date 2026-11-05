export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Lowercase, accent-free words used for word-prefix autocomplete. */
export function searchTokens(...parts: (string | null | undefined)[]): string[] {
  const words = parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  return [...new Set(words)];
}

export function variantLabel(optionValues: Record<string, string> | null | undefined): string {
  if (!optionValues) return '';
  return Object.values(optionValues).join(' / ');
}
