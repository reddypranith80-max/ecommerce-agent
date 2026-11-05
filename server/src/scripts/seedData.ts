import { Types } from 'mongoose';
import sharp from 'sharp';
import { priceOrder, type IndianState } from '@shop/shared';
import { logger } from '../config/logger';
import { Category, Inventory, InventoryMovement, Product } from '../models/catalog.model';
import { Coupon, CouponRedemption, Order, Payment } from '../models/order.model';
import { Review } from '../models/shopping.model';
import { Settings } from '../models/system.model';
import { Address, User } from '../models/user.model';
import { storeImage } from '../services/adminCatalog.service';
import { hashPassword } from '../services/auth.service';
import { recomputeAllProductAggregates, recomputeRatings } from '../services/catalog.service';
import { generateOrderNumber } from '../utils/crypto';
import { searchTokens, slugify } from '../utils/text';
import { categorySvg, productSvg, type ArtKind } from './productArt';

export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@demo.store', password: 'Admin@1234', name: 'Store Admin' },
  customer: { email: 'asha@demo.store', password: 'Shop@1234', name: 'Asha Rao' },
};

// Deterministic randomness so every fresh demo looks the same.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261105);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const COLORS: Record<string, string> = {
  White: '#f8fafc', Black: '#1f2937', Navy: '#1e3a8a', Olive: '#4d7c0f', Maroon: '#9f1239', Grey: '#9ca3af',
  Sand: '#d6c6a5', Teal: '#0f766e', Mustard: '#ca8a04', Blue: '#2563eb', Brown: '#92400e', Pink: '#f9a8d4',
  Leather: '#92400e', Steel: '#94a3b8', Terracotta: '#c2410c', Indigo: '#4338ca', Natural: '#e7d8b5',
};

const BACKGROUNDS: Record<string, [string, string]> = {
  clothing: ['#fef3c7', '#fde68a'],
  footwear: ['#dbeafe', '#bfdbfe'],
  accessories: ['#fce7f3', '#fbcfe8'],
  home: ['#dcfce7', '#bbf7d0'],
};

interface SeedProduct {
  name: string;
  brand: string;
  category: string; // leaf slug
  art: ArtKind;
  price: number; // rupees
  compareAt?: number;
  sizes?: string[];
  sizeLabel?: string;
  colors: string[];
  description: string;
  tags: string[];
  featured?: boolean;
  hsn: string;
}

const TOP = [
  { name: 'Clothing', slug: 'clothing', art: 'tshirt' as ArtKind, color: '#f59e0b' },
  { name: 'Footwear', slug: 'footwear', art: 'sneaker' as ArtKind, color: '#3b82f6' },
  { name: 'Accessories', slug: 'accessories', art: 'backpack' as ArtKind, color: '#ec4899' },
  { name: 'Home & Living', slug: 'home', art: 'lamp' as ArtKind, color: '#22c55e' },
];
const SUB: { name: string; slug: string; parent: string }[] = [
  { name: 'T-Shirts', slug: 't-shirts', parent: 'clothing' },
  { name: 'Hoodies & Sweatshirts', slug: 'hoodies', parent: 'clothing' },
  { name: 'Shirts', slug: 'shirts', parent: 'clothing' },
  { name: 'Sneakers', slug: 'sneakers', parent: 'footwear' },
  { name: 'Sandals & Slides', slug: 'sandals', parent: 'footwear' },
  { name: 'Bags', slug: 'bags', parent: 'accessories' },
  { name: 'Watches', slug: 'watches', parent: 'accessories' },
  { name: 'Caps & Hats', slug: 'caps', parent: 'accessories' },
  { name: 'Mugs & Drinkware', slug: 'mugs', parent: 'home' },
  { name: 'Cushions', slug: 'cushions', parent: 'home' },
  { name: 'Lighting', slug: 'lighting', parent: 'home' },
];

const APPAREL = ['S', 'M', 'L', 'XL'];
const SHOES = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'];

const PRODUCTS: SeedProduct[] = [
  { name: 'Classic Cotton Tee', brand: 'Loomcraft', category: 't-shirts', art: 'tshirt', price: 499, compareAt: 799, sizes: APPAREL, colors: ['White', 'Black', 'Navy'], featured: true, hsn: '6109', tags: ['cotton', 'basics'], description: 'A soft, breathable 180 GSM cotton tee with a regular fit. Pre-shrunk, so it keeps its shape wash after wash.' },
  { name: 'Graphic Print Tee', brand: 'Loomcraft', category: 't-shirts', art: 'tshirt', price: 649, sizes: APPAREL, colors: ['Mustard', 'Teal'], hsn: '6109', tags: ['graphic', 'cotton'], description: 'Bold screen-printed artwork on combed cotton. Relaxed fit with a ribbed crew neck.' },
  { name: 'Oversized Drop-Shoulder Tee', brand: 'Northpeak', category: 't-shirts', art: 'tshirt', price: 799, compareAt: 999, sizes: APPAREL, colors: ['Olive', 'Sand', 'Black'], hsn: '6109', tags: ['oversized', 'streetwear'], description: 'Heavyweight 240 GSM jersey with dropped shoulders and a boxy silhouette.' },
  { name: 'Organic Pocket Tee', brand: 'Greenthread', category: 't-shirts', art: 'tshirt', price: 599, sizes: APPAREL, colors: ['Grey', 'White'], hsn: '6109', tags: ['organic', 'cotton'], description: 'GOTS-certified organic cotton with a chest pocket. Dyed with low-impact dyes.' },
  { name: 'Everyday Fleece Hoodie', brand: 'Northpeak', category: 'hoodies', art: 'hoodie', price: 1499, compareAt: 2199, sizes: APPAREL, colors: ['Grey', 'Navy', 'Maroon'], featured: true, hsn: '6110', tags: ['fleece', 'winter'], description: 'Brushed fleece lining, kangaroo pocket and a double-layer hood. The hoodie you will reach for every day.' },
  { name: 'Zip-Up Track Jacket', brand: 'Stride', category: 'hoodies', art: 'hoodie', price: 1799, sizes: APPAREL, colors: ['Black', 'Blue'], hsn: '6110', tags: ['sports', 'jacket'], description: 'Lightweight poly-knit track jacket with a full zip and side pockets.' },
  { name: 'Crewneck Sweatshirt', brand: 'Loomcraft', category: 'hoodies', art: 'hoodie', price: 1199, sizes: APPAREL, colors: ['Sand', 'Olive'], hsn: '6110', tags: ['sweatshirt'], description: 'French-terry crewneck with ribbed cuffs. Warm without the bulk.' },
  { name: 'Oxford Button-Down Shirt', brand: 'Tailor & Co', category: 'shirts', art: 'shirt', price: 1299, sizes: APPAREL, colors: ['White', 'Blue'], hsn: '6205', tags: ['formal', 'cotton'], description: 'Classic Oxford weave with a button-down collar. Smart enough for work, easy enough for weekends.' },
  { name: 'Linen Summer Shirt', brand: 'Tailor & Co', category: 'shirts', art: 'shirt', price: 1599, compareAt: 1999, sizes: APPAREL, colors: ['Sand', 'White', 'Teal'], featured: true, hsn: '6205', tags: ['linen', 'summer'], description: 'Pure linen that gets softer with every wash. Breathable for hot Indian summers.' },
  { name: 'Flannel Check Shirt', brand: 'Northpeak', category: 'shirts', art: 'shirt', price: 1399, sizes: APPAREL, colors: ['Maroon', 'Navy'], hsn: '6205', tags: ['flannel', 'winter'], description: 'Brushed cotton flannel in a classic check. Wear it buttoned up or open over a tee.' },
  { name: 'Court Classic Sneakers', brand: 'Stride', category: 'sneakers', art: 'sneaker', price: 2499, compareAt: 3299, sizes: SHOES, sizeLabel: 'Size', colors: ['White', 'Black'], featured: true, hsn: '6404', tags: ['sneakers', 'casual'], description: 'Clean leather-look uppers, a cushioned insole and a grippy rubber cupsole.' },
  { name: 'Runner Lite Sneakers', brand: 'Stride', category: 'sneakers', art: 'sneaker', price: 2999, sizes: SHOES, sizeLabel: 'Size', colors: ['Blue', 'Grey'], hsn: '6404', tags: ['running', 'sports'], description: 'Breathable knit upper with a responsive foam midsole for daily runs.' },
  { name: 'Canvas Low-Tops', brand: 'Greenthread', category: 'sneakers', art: 'sneaker', price: 1299, compareAt: 1599, sizes: SHOES, sizeLabel: 'Size', colors: ['Natural', 'Black'], hsn: '6404', tags: ['canvas', 'casual'], description: 'Timeless canvas sneakers with a vulcanised rubber sole.' },
  { name: 'Everyday Slides', brand: 'Stride', category: 'sandals', art: 'sandal', price: 599, sizes: SHOES, sizeLabel: 'Size', colors: ['Black', 'Navy'], hsn: '6402', tags: ['slides', 'summer'], description: 'Contoured EVA footbed that is soft underfoot and quick to dry.' },
  { name: 'Trail Strap Sandals', brand: 'Northpeak', category: 'sandals', art: 'sandal', price: 1099, compareAt: 1399, sizes: SHOES, sizeLabel: 'Size', colors: ['Brown', 'Olive'], hsn: '6404', tags: ['sandals', 'outdoor'], description: 'Adjustable straps and a lugged sole for monsoon walks and weekend trails.' },
  { name: 'Daypack 22L Backpack', brand: 'Carryall', category: 'bags', art: 'backpack', price: 1899, compareAt: 2499, colors: ['Black', 'Teal', 'Grey'], featured: true, hsn: '4202', tags: ['backpack', 'laptop'], description: 'Padded 15-inch laptop sleeve, water-resistant fabric and a hidden passport pocket.' },
  { name: 'Canvas Tote Bag', brand: 'Greenthread', category: 'bags', art: 'tote', price: 549, colors: ['Natural', 'Black'], hsn: '4202', tags: ['tote', 'canvas'], description: 'Heavy cotton canvas tote with an inner zip pocket. Carries a full grocery run.' },
  { name: 'Leather Sling Bag', brand: 'Carryall', category: 'bags', art: 'sling', price: 1499, colors: ['Brown', 'Black'], hsn: '4202', tags: ['sling', 'leather'], description: 'Compact vegetable-tanned leather sling for your phone, wallet and keys.' },
  { name: 'Minimal Analog Watch', brand: 'Horologe', category: 'watches', art: 'watch', price: 2199, colors: ['Leather', 'Steel'], featured: true, hsn: '9102', tags: ['watch', 'analog'], description: 'A 40 mm dial with Japanese quartz movement and 3 ATM water resistance.' },
  { name: 'Sport Digital Watch', brand: 'Horologe', category: 'watches', art: 'watch', price: 1499, compareAt: 1999, colors: ['Black', 'Blue'], hsn: '9102', tags: ['watch', 'sports'], description: 'Stopwatch, alarm and backlight in a tough resin case.' },
  { name: 'Classic Baseball Cap', brand: 'Northpeak', category: 'caps', art: 'cap', price: 399, colors: ['Navy', 'Black', 'Sand'], hsn: '6505', tags: ['cap'], description: 'Six-panel cotton twill cap with an adjustable strap.' },
  { name: 'Reversible Bucket Hat', brand: 'Loomcraft', category: 'caps', art: 'bucket', price: 499, compareAt: 699, colors: ['Olive', 'Mustard'], hsn: '6505', tags: ['hat', 'summer'], description: 'Two looks in one: solid on one side, printed on the other.' },
  { name: 'Stoneware Coffee Mug', brand: 'Clayworks', category: 'mugs', art: 'mug', price: 349, colors: ['Terracotta', 'Indigo', 'White'], featured: true, hsn: '6912', tags: ['mug', 'ceramic'], description: 'Hand-glazed 350 ml stoneware mug. Microwave and dishwasher safe.' },
  { name: 'Insulated Travel Mug', brand: 'Carryall', category: 'mugs', art: 'travelmug', price: 899, compareAt: 1199, colors: ['Steel', 'Black'], hsn: '7323', tags: ['travel', 'insulated'], description: 'Double-wall steel keeps drinks hot for 6 hours and cold for 12.' },
  { name: 'Set of 4 Espresso Cups', brand: 'Clayworks', category: 'mugs', art: 'cups', price: 999, colors: ['White', 'Terracotta'], hsn: '6912', tags: ['espresso', 'gift'], description: 'Four 90 ml cups with saucers, made by small-batch potters in Khurja.' },
  { name: 'Handloom Cushion Cover', brand: 'Weavehouse', category: 'cushions', art: 'cushion', price: 449, colors: ['Indigo', 'Mustard', 'Natural'], hsn: '6304', tags: ['handloom', 'decor'], description: '16 × 16 inch cover hand-woven on pit looms. Concealed zip.' },
  { name: 'Velvet Throw Pillow', brand: 'Weavehouse', category: 'cushions', art: 'cushion', price: 799, compareAt: 999, colors: ['Teal', 'Pink', 'Maroon'], hsn: '6304', tags: ['velvet', 'decor'], description: 'Plush velvet with a feather-soft fill. Adds colour to any sofa.' },
  { name: 'Ceramic Table Lamp', brand: 'Lumen', category: 'lighting', art: 'lamp', price: 1999, compareAt: 2599, colors: ['White', 'Terracotta'], featured: true, hsn: '9405', tags: ['lamp', 'ceramic'], description: 'Hand-thrown ceramic base with a linen shade. Takes a standard E27 bulb.' },
  { name: 'Rattan Pendant Light', brand: 'Lumen', category: 'lighting', art: 'pendant', price: 2799, colors: ['Natural'], hsn: '9405', tags: ['pendant', 'rattan'], description: 'Woven rattan shade that casts warm, patterned light across the room.' },
  { name: 'LED Desk Lamp', brand: 'Lumen', category: 'lighting', art: 'desklamp', price: 1599, colors: ['Black', 'White'], hsn: '9405', tags: ['led', 'desk'], description: 'Three colour temperatures, five brightness levels and a USB charging port.' },
];

const CITIES: { city: string; state: IndianState; pin: string }[] = [
  { city: 'Bengaluru', state: 'Karnataka', pin: '560034' },
  { city: 'Mumbai', state: 'Maharashtra', pin: '400050' },
  { city: 'New Delhi', state: 'Delhi', pin: '110017' },
  { city: 'Chennai', state: 'Tamil Nadu', pin: '600020' },
  { city: 'Hyderabad', state: 'Telangana', pin: '500081' },
  { city: 'Pune', state: 'Maharashtra', pin: '411001' },
  { city: 'Kolkata', state: 'West Bengal', pin: '700019' },
  { city: 'Jaipur', state: 'Rajasthan', pin: '302001' },
  { city: 'Kochi', state: 'Kerala', pin: '682016' },
  { city: 'Ahmedabad', state: 'Gujarat', pin: '380009' },
];
const FIRST = ['Rohan', 'Priya', 'Arjun', 'Kavya', 'Vikram', 'Neha', 'Aditya', 'Sneha', 'Rahul', 'Ananya', 'Karthik', 'Meera', 'Siddharth', 'Isha', 'Farhan', 'Divya'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Khan', 'Das', 'Menon', 'Joshi', 'Singh', 'Bose'];
const REVIEW_LINES: [number, string, string][] = [
  [5, 'Exactly as described', 'Great quality for the price. Fits well and the colour is spot on.'],
  [5, 'Love it', 'Bought one, came back for two more. Delivery was quick too.'],
  [4, 'Very good', 'Nice material and finish. Slightly different shade than the photo, but I like it.'],
  [4, 'Good value', 'Does the job well. Packaging was neat and it arrived on time.'],
  [3, 'Decent', 'It is okay. Quality is fine, but I expected it to be a little sturdier.'],
  [5, 'Gift was a hit', 'Gave this as a gift and they loved it. Will order again.'],
  [4, 'Comfortable', 'Comfortable for daily use. Sizing runs true.'],
  [2, 'Not for me', 'The product is fine but it did not suit what I needed. Returns would help.'],
];

/** Rasterise the SVG first: the upload pipeline (correctly) accepts only JPEG/PNG/WebP/AVIF. */
async function art(svg: string, folder: string) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return storeImage(png, folder);
}

export async function seedDatabase(): Promise<void> {
  const started = Date.now();
  await Settings.updateOne({ _id: 'store' }, { $setOnInsert: { _id: 'store' } }, { upsert: true });

  // ---- users
  const [adminHash, customerHash, otherHash] = await Promise.all([
    hashPassword(DEMO_ACCOUNTS.admin.password),
    hashPassword(DEMO_ACCOUNTS.customer.password),
    hashPassword('Customer@1234'),
  ]);
  await User.create({ name: DEMO_ACCOUNTS.admin.name, email: DEMO_ACCOUNTS.admin.email, passwordHash: adminHash, role: 'admin' });
  const asha = await User.create({ name: DEMO_ACCOUNTS.customer.name, email: DEMO_ACCOUNTS.customer.email, passwordHash: customerHash, role: 'customer', phone: '+919876543210' });
  const customers = [asha];
  for (let i = 0; i < 16; i++) {
    const name = `${FIRST[i % FIRST.length]} ${pick(LAST)}`;
    const created = new Date(Date.now() - int(1, 60) * 86_400_000);
    const u = new User({ name, email: `${slugify(name).replace(/-/g, '.')}${i}@example.com`, passwordHash: otherHash, role: 'customer', phone: `+9198${String(10000000 + i * 7919).slice(0, 8)}` });
    u.set('createdAt', created);
    await User.collection.insertOne({ ...u.toObject(), createdAt: created, updatedAt: created });
    customers.push(u);
  }
  const addresses = new Map<string, InstanceType<typeof Address>>();
  for (const [i, c] of customers.entries()) {
    const loc = i === 0 ? CITIES[0]! : pick(CITIES);
    const a = await Address.create({
      userId: c._id, label: 'Home', fullName: c.name, phone: c.phone ?? '+919800000000',
      line1: `${int(1, 300)}, ${pick(['MG Road', 'Park Street', 'Linking Road', 'Anna Salai', 'Banjara Hills Rd', 'FC Road'])}`,
      line2: pick(['2nd Floor', 'Flat 4B', 'Near Metro Station', '']), city: loc.city, state: loc.state, postalCode: loc.pin, isDefault: true,
    });
    addresses.set(c.id as string, a);
  }

  // ---- categories
  const catBySlug = new Map<string, InstanceType<typeof Category>>();
  for (const [i, t] of TOP.entries()) {
    const media = await art(categorySvg(t.art, t.color, BACKGROUNDS[t.slug]!), 'categories');
    const c = await Category.create({ name: t.name, slug: t.slug, sortOrder: i, imageKey: media.thumbKey });
    media.attachedTo = c._id;
    await media.save();
    catBySlug.set(t.slug, c);
  }
  for (const [i, s] of SUB.entries()) {
    const parent = catBySlug.get(s.parent)!;
    const c = await Category.create({ name: s.name, slug: s.slug, parentId: parent._id, ancestors: [parent._id], depth: 1, sortOrder: i });
    catBySlug.set(s.slug, c);
  }

  // ---- products, variants, inventory
  const products: { doc: InstanceType<typeof Product>; seed: SeedProduct }[] = [];
  for (const [index, sp] of PRODUCTS.entries()) {
    const leaf = catBySlug.get(sp.category)!;
    const top = SUB.find((s) => s.slug === sp.category)!.parent;
    const productId = new Types.ObjectId();
    const images = [];
    for (const color of sp.colors.slice(0, 3)) {
      const media = await art(productSvg(sp.art, COLORS[color] ?? '#94a3b8', BACKGROUNDS[top]!, `${sp.name} — ${color}`), 'products');
      media.attachedTo = productId;
      await media.save();
      images.push({ mediaId: media._id, key: media.key, thumbKey: media.thumbKey, alt: `${sp.name} in ${color}`, width: media.width, height: media.height });
    }
    const options = [...(sp.sizes ? [{ name: sp.sizeLabel ?? 'Size', values: sp.sizes }] : []), { name: sp.art === 'watch' ? 'Strap' : 'Colour', values: sp.colors }];
    const combos: Record<string, string>[] = [];
    for (const color of sp.colors) {
      if (sp.sizes) for (const size of sp.sizes) combos.push({ [sp.sizeLabel ?? 'Size']: size, [options.at(-1)!.name]: color });
      else combos.push({ [options.at(-1)!.name]: color });
    }
    const skuBase = sp.name.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0]).join('').toUpperCase().slice(0, 4) + String(index + 1).padStart(2, '0');
    const variants = combos.map((ov) => ({
      _id: new Types.ObjectId(),
      sku: `${skuBase}-${Object.values(ov).map((v) => v.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase()).join('-')}`,
      optionValues: ov,
      price: sp.price * 100 + (ov.Size === 'XL' ? 5000 : 0),
      compareAtPrice: sp.compareAt ? sp.compareAt * 100 + (ov.Size === 'XL' ? 5000 : 0) : null,
      isActive: true,
    }));
    const publishedAt = new Date(Date.now() - (PRODUCTS.length - index) * 86_400_000 * 1.5);
    const doc = await Product.create({
      _id: productId, name: sp.name, slug: slugify(sp.name), description: sp.description, brand: sp.brand, tags: sp.tags,
      searchTokens: searchTokens(sp.name, sp.brand), categoryId: leaf._id, categoryPath: [...leaf.ancestors, leaf._id],
      images, options, variants, status: 'active', isFeatured: Boolean(sp.featured), hsnCode: sp.hsn, gstRate: sp.price > 1000 ? 12 : 5, publishedAt,
    });
    const stock = variants.map(() => {
      const r = rand();
      return r < 0.08 ? 0 : r < 0.2 ? int(1, 4) : int(8, 40);
    });
    // One deliberately scarce item so a "last unit" race can be shown live.
    if (index === 0) stock[0] = 1;
    await Inventory.insertMany(variants.map((v, i) => ({ sku: v.sku, productId, variantId: v._id, available: stock[i]!, reserved: 0, allocated: 0, lowStockThreshold: 5 })));
    await InventoryMovement.insertMany(variants.map((v, i) => ({ sku: v.sku, productId, type: 'initial', delta: { available: stock[i]! }, reason: 'Opening stock (seed)' })));
    products.push({ doc, seed: sp });
  }

  // ---- coupons
  const now = Date.now();
  await Coupon.insertMany([
    { code: 'WELCOME10', description: '10% off your order (up to ₹200)', type: 'percentage', value: 10, maxDiscount: 20000, minOrderValue: 49900, startsAt: new Date(now - 30 * 86_400_000), endsAt: new Date(now + 365 * 86_400_000), perUserLimit: 1 },
    { code: 'FLAT150', description: '₹150 off orders above ₹1,499', type: 'fixed', value: 15000, minOrderValue: 149900, startsAt: new Date(now - 30 * 86_400_000), endsAt: new Date(now + 180 * 86_400_000), perUserLimit: 3 },
    { code: 'FESTIVE25', description: 'Festive sale: 25% off (up to ₹750), first 50 orders', type: 'percentage', value: 25, maxDiscount: 75000, minOrderValue: 200000, usageLimit: 50, startsAt: new Date(now - 5 * 86_400_000), endsAt: new Date(now + 20 * 86_400_000), perUserLimit: 1 },
    { code: 'LASTUNIT', description: 'Single-use coupon (demo of usage limits)', type: 'fixed', value: 10000, minOrderValue: 0, usageLimit: 1, startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 90 * 86_400_000), perUserLimit: 1 },
    { code: 'MONSOON20', description: 'Expired campaign (shows the "expired" error)', type: 'percentage', value: 20, maxDiscount: 50000, minOrderValue: 0, startsAt: new Date(now - 120 * 86_400_000), endsAt: new Date(now - 30 * 86_400_000), perUserLimit: 1 },
  ]);

  // ---- a month of order history (so the dashboard, reports and reviews have real data)
  const settings = (await Settings.findById('store'))!;
  const inventory = await Inventory.find().lean();
  const inStock = new Map(inventory.map((i) => [i.sku, i.available]));
  const allocate = new Map<string, number>();
  const deliveredPairs: { userId: Types.ObjectId; productId: Types.ObjectId; orderId: Types.ObjectId; at: Date }[] = [];
  const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'processing', 'confirmed', 'cancelled'] as const;

  const orders = [];
  const payments = [];
  for (let n = 0; n < 72; n++) {
    const customer = n < 4 ? asha : pick(customers.slice(1));
    const daysAgo = n < 4 ? [2, 9, 16, 24][n]! : int(0, 29);
    const placedAt = new Date(now - daysAgo * 86_400_000 - int(1, 20) * 3600_000);
    const status = n < 4 ? (['shipped', 'delivered', 'delivered', 'confirmed'] as const)[n]! : daysAgo < 2 ? pick(['confirmed', 'processing'] as const) : pick(statuses);
    const method = rand() < 0.6 ? 'online' : 'cod';
    const lineCount = int(1, 3);
    const lines: { p: (typeof products)[number]; v: (typeof products)[number]['doc']['variants'][number]; qty: number; sku: string }[] = [];
    for (let l = 0; l < lineCount; l++) {
      const p = pick(products);
      const v = pick(p.doc.variants);
      if (lines.some((x) => x.sku === v.sku)) continue;
      const qty = int(1, 2);
      const openStock = (inStock.get(v.sku) ?? 0) - (allocate.get(v.sku) ?? 0);
      if ((status === 'confirmed' || status === 'processing') && openStock < qty) continue;
      lines.push({ p, v, qty, sku: v.sku });
    }
    if (lines.length === 0) continue;
    const pricing = priceOrder(lines.map((l) => ({ key: l.sku, unitPrice: l.v.price, quantity: l.qty })), null, settings);
    const address = addresses.get(customer.id as string)!;
    const orderId = new Types.ObjectId();
    const hours = (h: number) => new Date(placedAt.getTime() + h * 3600_000);
    const history: { status: string; at: Date; actorType: string; note?: string }[] = [{ status: 'confirmed', at: placedAt, actorType: method === 'online' ? 'system' : 'customer', note: method === 'online' ? 'Payment received (virtual money)' : 'Order placed with Cash on Delivery' }];
    const steps = { processing: 6, shipped: 24, delivered: 72 } as const;
    const reached = status === 'cancelled' ? [] : (['processing', 'shipped', 'delivered'] as const).slice(0, ['confirmed', 'processing', 'shipped', 'delivered'].indexOf(status));
    for (const s of reached) history.push({ status: s, at: hours(steps[s]), actorType: 'admin' });
    if (status === 'cancelled') history.push({ status: 'cancelled', at: hours(2), actorType: 'customer', note: 'Ordered by mistake' });
    const paid = method === 'online' || status === 'delivered';
    const stockState = status === 'cancelled' ? 'released' : status === 'confirmed' || status === 'processing' ? 'allocated' : 'shipped';
    if (stockState === 'allocated') for (const l of lines) allocate.set(l.sku, (allocate.get(l.sku) ?? 0) + l.qty);

    const order = new Order({
      _id: orderId, orderNumber: generateOrderNumber(placedAt), userId: customer._id,
      customer: { name: customer.name, email: customer.email, phone: address.phone },
      items: lines.map((l, i) => ({
        productId: l.p.doc._id, variantId: l.v._id, sku: l.sku, name: l.p.doc.name, slug: l.p.doc.slug,
        variantLabel: Object.values(l.v.optionValues as Record<string, string>).join(' / '), imageKey: l.p.doc.images[0]?.thumbKey,
        unitPrice: l.v.price, compareAtPrice: l.v.compareAtPrice, quantity: l.qty, lineSubtotal: pricing.lines[i]!.lineSubtotal,
        discountShare: 0, lineTotal: pricing.lines[i]!.lineTotal, hsnCode: l.p.seed.hsn, gstRate: l.p.doc.gstRate,
      })),
      shippingAddress: { label: address.label, fullName: address.fullName, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, country: 'IN' },
      pricing: { subtotal: pricing.subtotal, discount: 0, shippingFee: pricing.shippingFee, total: pricing.total, currency: 'INR', taxInclusive: true },
      paymentMethod: method,
      gatewayOrderId: method === 'online' ? `order_seed${n}${orderId.toString().slice(-8)}` : undefined,
      status,
      paymentStatus: status === 'cancelled' ? (method === 'online' ? 'refunded' : 'unpaid') : paid ? 'paid' : 'unpaid',
      stockState,
      statusHistory: history,
      fulfilment: reached.includes('shipped' as never) || status === 'shipped' || status === 'delivered'
        ? { carrier: pick(['Delhivery', 'Blue Dart', 'Ekart', 'India Post']), trackingNumber: `TRK${int(10000000, 99999999)}`, trackingUrl: 'https://example.com/track' }
        : undefined,
      confirmedAt: placedAt,
      paidAt: paid ? (method === 'online' ? placedAt : hours(72)) : undefined,
      processingAt: reached.includes('processing') ? hours(6) : undefined,
      shippedAt: reached.includes('shipped') ? hours(24) : undefined,
      deliveredAt: status === 'delivered' ? hours(72) : undefined,
      cancelledAt: status === 'cancelled' ? hours(2) : undefined,
      refundedAt: status === 'cancelled' && method === 'online' ? hours(3) : undefined,
      cancellation: status === 'cancelled' ? { reason: 'Ordered by mistake', actorType: 'customer' } : undefined,
    });
    orders.push({ ...order.toObject(), createdAt: placedAt, updatedAt: placedAt });
    if (paid) {
      const capturedAt = method === 'online' ? placedAt : hours(72);
      payments.push({
        orderId, userId: customer._id, provider: method === 'online' ? 'demopay' : 'cod',
        gatewayPaymentId: method === 'online' ? `pay_seed${n}${orderId.toString().slice(-8)}` : undefined,
        gatewayOrderId: order.gatewayOrderId, amount: pricing.total, currency: 'INR', method: method === 'online' ? pick(['upi', 'card', 'netbanking']) : 'cash',
        status: status === 'cancelled' ? 'refunded' : 'captured', capturedAt, disposition: 'applied', refundedAmount: status === 'cancelled' ? pricing.total : 0,
        createdAt: capturedAt, updatedAt: capturedAt,
      });
    }
    if (status === 'delivered') for (const l of lines) deliveredPairs.push({ userId: customer._id, productId: l.p.doc._id, orderId, at: hours(96) });
  }
  await Order.collection.insertMany(orders);
  if (payments.length) await Payment.collection.insertMany(payments.map((p) => ({ ...new Payment(p).toObject(), createdAt: p.createdAt, updatedAt: p.updatedAt })));
  for (const [sku, qty] of allocate) await Inventory.updateOne({ sku }, { $inc: { allocated: qty } });

  // ---- reviews from verified buyers
  const seen = new Set<string>();
  const reviewDocs = [];
  for (const pair of deliveredPairs) {
    const key = `${pair.userId}:${pair.productId}`;
    if (seen.has(key) || pair.userId.equals(asha._id)) continue; // Asha's reviews are left for the live demo
    seen.add(key);
    const [rating, title, body] = pick(REVIEW_LINES);
    reviewDocs.push({ productId: pair.productId, userId: pair.userId, orderId: pair.orderId, rating, title, body, status: 'published', createdAt: pair.at, updatedAt: pair.at });
  }
  if (reviewDocs.length) await Review.collection.insertMany(reviewDocs);
  await CouponRedemption.init();

  await recomputeAllProductAggregates();
  for (const p of products) await recomputeRatings(p.doc._id);
  logger.info(
    { products: products.length, orders: orders.length, reviews: reviewDocs.length, ms: Date.now() - started },
    'Demo data loaded',
  );
}
