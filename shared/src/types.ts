import type {
  CartLineIssue,
  CouponRejection,
  IndianState,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
  RefundStatus,
  Role,
  StockStatus,
} from './enums';
import type { ActorType } from './orderStates';
import type { Permission } from './permissions';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  permissions: Permission[];
  createdAt: string;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}

export interface Address {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: IndianState;
  postalCode: string;
  country: 'IN';
  isDefault: boolean;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  depth: number;
  sortOrder: number;
  isActive: boolean;
  imageUrl: string | null;
  version?: number;
  children: CategoryNode[];
}

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  priceMin: number;
  priceMax: number;
  compareAtPrice: number | null;
  maxDiscountPct: number;
  ratingAvg: number;
  ratingCount: number;
  stockStatus: StockStatus;
}

export interface ProductImage {
  mediaId: string;
  url: string;
  thumbUrl: string;
  alt: string;
  width: number;
  height: number;
}

export interface ProductVariant {
  id: string;
  sku: string;
  optionValues: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  available: number;
  inStock: boolean;
}

export interface ProductDetail extends ProductCard {
  description: string;
  tags: string[];
  images: ProductImage[];
  category: { id: string; name: string; slug: string };
  breadcrumb: { name: string; slug: string }[];
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
}

export interface ProductListResponse {
  data: ProductCard[];
  meta: PageMeta & { priceBounds: { min: number; max: number } };
}

export interface HomeData {
  hero: { title: string; subtitle: string };
  categories: { id: string; name: string; slug: string; imageUrl: string | null }[];
  featured: ProductCard[];
  offers: ProductCard[];
  newArrivals: ProductCard[];
  trending: ProductCard[];
}

export interface PublicConfig {
  storeName: string;
  currency: 'INR';
  codEnabled: boolean;
  codMaxOrderValue: number;
  shippingFlatFee: number;
  freeShippingThreshold: number;
  paymentWindowMinutes: number;
  paymentKeyId: string;
  supportEmail: string;
  supportPhone: string;
  demoMode: boolean;
}

export interface CartLine {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  slug: string;
  name: string;
  variantLabel: string;
  imageUrl: string | null;
  unitPrice: number;
  previousUnitPrice: number | null;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  available: number;
  issues: CartLineIssue[];
  warnings: 'price_changed'[];
}

export interface Cart {
  items: CartLine[];
  subtotal: number;
  itemCount: number;
}

export interface Quote {
  lines: CartLine[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  coupon: { code: string; discount: number } | null;
  couponError: { reason: CouponRejection } | null;
  cod: { available: boolean; reason: null | 'disabled' | 'over_limit' | 'open_orders_limit' };
  issues: { sku: string; issue: CartLineIssue }[];
  warnings: { sku: string; warning: 'price_changed'; previousUnitPrice: number }[];
}

export interface PaymentInit {
  provider: 'demopay';
  keyId: string;
  gatewayOrderId: string;
  amount: number;
  currency: 'INR';
  windowEndsAt: string;
  prefill: { name: string; email: string; contact: string };
}

export interface OrderItem {
  productId: string;
  variantId: string;
  sku: string;
  slug: string;
  name: string;
  variantLabel: string;
  imageUrl: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineSubtotal: number;
  discountShare: number;
  lineTotal: number;
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: string;
  actorType: ActorType;
  note: string | null;
}

export interface OrderRefund {
  id: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  requestedAt: string;
  processedAt: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
  shippingAddress: Omit<Address, 'id' | 'isDefault'>;
  pricing: { subtotal: number; discount: number; shippingFee: number; total: number; currency: 'INR' };
  coupon: { code: string; discount: number } | null;
  statusHistory: OrderStatusEvent[];
  fulfilment: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; undeliveredReason: string | null };
  windowEndsAt: string | null;
  cancellation: { reason: string; actorType: ActorType } | null;
  refunds: OrderRefund[];
  createdAt: string;
  canCancel: boolean;
  canPay: boolean;
}

export interface OrderSummary {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: PaymentMethod;
  total: number;
  itemCount: number;
  firstItemName: string;
  firstItemImageUrl: string | null;
  createdAt: string;
}

export interface PlaceOrderResult {
  order: Order;
  payment: PaymentInit | null;
  paymentError: { code: string; message: string } | null;
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface ReviewSummary {
  ratingAvg: number;
  ratingCount: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface ReviewEligibility {
  canReview: boolean;
  reason: 'not_purchased' | 'already_reviewed' | null;
  existingReviewId: string | null;
}

export interface DemoEmail {
  id: string;
  to: string;
  subject: string;
  text: string;
  createdAt: string;
}

// ---------- admin ----------
export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  categoryName: string;
  imageUrl: string | null;
  priceMin: number;
  priceMax: number;
  variantCount: number;
  stockStatus: StockStatus;
  totalAvailable: number;
  updatedAt: string;
}

export interface AdminProduct {
  id: string;
  version: number;
  name: string;
  slug: string;
  description: string;
  brand: string | null;
  tags: string[];
  categoryId: string;
  status: ProductStatus;
  isFeatured: boolean;
  everOrdered: boolean;
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    sku: string;
    optionValues: Record<string, string>;
    price: number;
    compareAtPrice: number | null;
    isActive: boolean;
    available: number;
    reserved: number;
    allocated: number;
    lowStockThreshold: number;
  }[];
  images: ProductImage[];
  hsnCode: string | null;
  gstRate: number | null;
}

export interface MediaUpload {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface InventoryRow {
  sku: string;
  productId: string;
  productName: string;
  variantLabel: string;
  available: number;
  reserved: number;
  allocated: number;
  onHand: number;
  lowStockThreshold: number;
  isLowStock: boolean;
}

export interface InventoryMovementRow {
  id: string;
  type: string;
  delta: { available: number; reserved: number; allocated: number };
  orderNumber: string | null;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface AdminOrderRow {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: PaymentMethod;
  total: number;
  itemCount: number;
  needsReview: boolean;
  createdAt: string;
}

export interface AdminPaymentRow {
  id: string;
  provider: 'demopay' | 'cod';
  gatewayPaymentId: string | null;
  amount: number;
  method: string | null;
  status: string;
  disposition: string | null;
  createdAt: string;
}

export interface AdminOrder extends Order {
  customer: { id: string; name: string; email: string; phone: string | null };
  payments: AdminPaymentRow[];
  allowedTransitions: OrderStatus[];
  needsReview: { reason: string; at: string } | null;
  stockState: string;
}

export interface AdminCustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'active' | 'blocked';
  orderCount: number;
  lifetimeSpend: number;
  createdAt: string;
}

export interface AdminCoupon {
  id: string;
  version: number;
  code: string;
  description: string;
  type: 'percentage' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  isActive: boolean;
  state: 'active' | 'scheduled' | 'expired' | 'inactive';
}

export interface AdminReviewRow extends Review {
  status: 'published' | 'hidden';
  productName: string;
  productSlug: string;
  authorEmail: string;
}

export interface AdminRefundRow {
  id: string;
  orderNumber: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  attempts: number;
  lastError: string | null;
  requestedAt: string;
  processedAt: string | null;
}

export interface StoreSettings {
  version: number;
  storeName: string;
  supportEmail: string;
  supportPhone: string;
  codEnabled: boolean;
  codMaxOrderValue: number;
  codMaxOpenOrders: number;
  shippingFlatFee: number;
  freeShippingThreshold: number;
  paymentWindowMinutes: number;
  paymentGraceMinutes: number;
  defaultLowStockThreshold: number;
  heroTitle: string;
  heroSubtitle: string;
}

export interface DashboardData {
  range: { from: string; to: string };
  kpis: {
    grossSales: { value: number; previous: number };
    netRevenue: { value: number; previous: number };
    orders: { value: number; previous: number };
    averageOrderValue: { value: number; previous: number };
    newCustomers: { value: number; previous: number };
  };
  awaitingFulfilment: number;
  lowStockCount: number;
  series: { date: string; grossSales: number; orders: number }[];
  ordersByStatus: { status: OrderStatus; count: number }[];
  topProducts: { productId: string; name: string; units: number; revenue: number }[];
  latestOrders: AdminOrderRow[];
  attention: { failedRefunds: number; pendingRefunds: number; needsReview: number; lowStock: number };
}

export interface SalesReportRow {
  date: string;
  orders: number;
  grossSales: number;
  discounts: number;
  shipping: number;
  refunds: number;
  netRevenue: number;
  averageOrderValue: number;
  onlineOrders: number;
  codOrders: number;
}

export interface AuditLogRow {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}
