/** Generates simple, consistent product illustrations as SVG (rendered to WebP by sharp during seeding). */

export type ArtKind =
  | 'tshirt' | 'hoodie' | 'shirt' | 'sneaker' | 'sandal' | 'backpack' | 'tote' | 'sling'
  | 'watch' | 'cap' | 'bucket' | 'mug' | 'travelmug' | 'cups' | 'cushion' | 'lamp' | 'pendant' | 'desklamp';

const SHAPES: Record<ArtKind, (fill: string, accent: string) => string> = {
  tshirt: (f, a) => `<path d="M30 22 L44 14 Q50 21 56 14 L70 22 L82 36 L70 43 L70 86 L30 86 L30 43 L18 36 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M44 14 Q50 24 56 14" fill="none" stroke="${a}" stroke-width="1.2"/>`,
  hoodie: (f, a) => `<path d="M30 26 L42 18 Q50 30 58 18 L70 26 L86 62 L76 66 L70 48 L70 88 L30 88 L30 48 L24 66 L14 62 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M40 20 Q50 6 60 20 Q50 34 40 20 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><rect x="40" y="62" width="20" height="10" rx="2" fill="none" stroke="${a}" stroke-width="1"/>`,
  shirt: (f, a) => `<path d="M30 22 L42 15 L50 24 L58 15 L70 22 L84 58 L74 62 L70 46 L70 88 L30 88 L30 46 L26 62 L16 58 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M42 15 L50 30 L58 15 M50 30 L50 88" fill="none" stroke="${a}" stroke-width="1"/><circle cx="50" cy="42" r="1.3" fill="${a}"/><circle cx="50" cy="56" r="1.3" fill="${a}"/><circle cx="50" cy="70" r="1.3" fill="${a}"/>`,
  sneaker: (f, a) => `<path d="M10 66 Q11 52 26 50 L40 40 Q50 36 56 46 L82 54 Q92 57 91 66 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><rect x="9" y="66" width="83" height="8" rx="4" fill="#f8fafc" stroke="${a}" stroke-width="1.2"/><path d="M42 44 L48 52 M47 41 L53 49 M52 39 L57 47" stroke="${a}" stroke-width="1.2"/>`,
  sandal: (f, a) => `<ellipse cx="50" cy="66" rx="40" ry="12" fill="#e7e5e4" stroke="${a}" stroke-width="1.2"/><path d="M24 64 Q34 40 48 62 M46 64 Q60 38 76 64" fill="none" stroke="${f}" stroke-width="7" stroke-linecap="round"/>`,
  backpack: (f, a) => `<path d="M38 22 Q50 8 62 22" fill="none" stroke="${a}" stroke-width="3"/><rect x="26" y="22" width="48" height="66" rx="12" fill="${f}" stroke="${a}" stroke-width="1.2"/><rect x="34" y="58" width="32" height="22" rx="5" fill="none" stroke="${a}" stroke-width="1.2"/><path d="M34 40 L66 40" stroke="${a}" stroke-width="1"/>`,
  tote: (f, a) => `<path d="M36 34 Q36 14 50 14 Q64 14 64 34" fill="none" stroke="${a}" stroke-width="3"/><path d="M24 34 L76 34 L70 88 L30 88 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/>`,
  sling: (f, a) => `<path d="M20 20 Q50 70 80 20" fill="none" stroke="${a}" stroke-width="3"/><rect x="28" y="46" width="44" height="34" rx="10" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M28 58 L72 58" stroke="${a}" stroke-width="1"/>`,
  watch: (f, a) => `<rect x="40" y="8" width="20" height="26" rx="4" fill="${f}"/><rect x="40" y="66" width="20" height="26" rx="4" fill="${f}"/><circle cx="50" cy="50" r="20" fill="#f8fafc" stroke="${a}" stroke-width="3"/><path d="M50 50 L50 38 M50 50 L58 54" stroke="${a}" stroke-width="2" stroke-linecap="round"/>`,
  cap: (f, a) => `<path d="M22 60 Q22 28 50 28 Q78 28 78 60 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M70 60 Q90 60 92 68 L60 68 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><circle cx="50" cy="28" r="2.5" fill="${a}"/>`,
  bucket: (f, a) => `<path d="M32 58 L36 30 Q50 24 64 30 L68 58 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><ellipse cx="50" cy="60" rx="32" ry="8" fill="${f}" stroke="${a}" stroke-width="1.2"/>`,
  mug: (f, a) => `<rect x="24" y="28" width="40" height="52" rx="6" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M64 40 Q80 40 80 54 Q80 68 64 68" fill="none" stroke="${a}" stroke-width="5"/><path d="M34 20 Q38 14 34 8 M46 20 Q50 14 46 8" fill="none" stroke="${a}" stroke-width="1.2" opacity=".5"/>`,
  travelmug: (f, a) => `<path d="M34 24 L66 24 L62 88 L38 88 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><rect x="31" y="16" width="38" height="10" rx="3" fill="${a}"/><rect x="36" y="46" width="28" height="12" fill="#ffffff" opacity=".35"/>`,
  cups: (f, a) => [20, 44, 68].map((x) => `<rect x="${x}" y="48" width="18" height="24" rx="3" fill="${f}" stroke="${a}" stroke-width="1.2"/><ellipse cx="${x + 9}" cy="76" rx="13" ry="3" fill="#e7e5e4"/>`).join(''),
  cushion: (f, a) => `<path d="M20 24 Q50 32 80 24 Q72 50 80 76 Q50 68 20 76 Q28 50 20 24 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M30 40 L70 40 M30 50 L70 50 M30 60 L70 60" stroke="${a}" stroke-width="1" opacity=".5"/>`,
  lamp: (f, a) => `<path d="M30 46 L38 14 L62 14 L70 46 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><rect x="47" y="46" width="6" height="30" fill="${a}"/><ellipse cx="50" cy="82" rx="18" ry="6" fill="${a}"/>`,
  pendant: (f, a) => `<path d="M50 4 L50 30" stroke="${a}" stroke-width="1.5"/><path d="M24 70 Q24 30 50 30 Q76 30 76 70 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/><path d="M32 66 Q50 40 68 66 M40 68 Q50 46 60 68" fill="none" stroke="${a}" stroke-width="1" opacity=".6"/><circle cx="50" cy="74" r="5" fill="#fde68a"/>`,
  desklamp: (f, a) => `<ellipse cx="34" cy="86" rx="18" ry="5" fill="${a}"/><path d="M34 84 L46 52 L70 36" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/><path d="M62 26 L84 34 L74 50 Z" fill="${f}" stroke="${a}" stroke-width="1.2"/>`,
};

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function productSvg(kind: ArtKind, fill: string, background: [string, string], label: string): string {
  const accent = '#1f2937';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${background[0]}"/><stop offset="1" stop-color="${background[1]}"/></linearGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <circle cx="50" cy="50" r="38" fill="#ffffff" opacity=".35"/>
  <g transform="translate(10 6) scale(.8)">${SHAPES[kind](fill, accent)}</g>
  <text x="50" y="95" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="4.2" font-weight="600" fill="#1f2937" opacity=".7">${escapeXml(label)}</text>
</svg>`;
}

export function categorySvg(kind: ArtKind, fill: string, background: [string, string]): string {
  return productSvg(kind, fill, background, '');
}
