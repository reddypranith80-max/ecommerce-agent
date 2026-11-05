import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, isRouteErrorResponse, useLocation, useRouteError, type RouteObject } from 'react-router';
import { StoreLayout } from '../components/store';
import { ButtonLink, EmptyState, Spinner } from '../components/ui';
import { isAdmin, useSession } from '../store/session';

const page = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

const shop = () => import('../pages/shop');
const cart = () => import('../pages/cart');
const checkout = () => import('../pages/checkout');
const orders = () => import('../pages/orders');
const authP = () => import('../pages/auth');
const account = () => import('../pages/account');
const adminLayout = () => import('../pages/admin/layout');
const adminCatalog = () => import('../pages/admin/catalog');
const adminOps = () => import('../pages/admin/operations');
const adminMarketing = () => import('../pages/admin/marketing');

const HomePage = page(shop, 'HomePage');
const ProductsPage = page(shop, 'ProductsPage');
const ProductPage = page(shop, 'ProductPage');
const CartPage = page(cart, 'CartPage');
const WishlistPage = page(cart, 'WishlistPage');
const CheckoutPage = page(checkout, 'CheckoutPage');
const OrdersPage = page(orders, 'OrdersPage');
const OrderPage = page(orders, 'OrderPage');
const LoginPage = page(authP, 'LoginPage');
const RegisterPage = page(authP, 'RegisterPage');
const ForgotPasswordPage = page(authP, 'ForgotPasswordPage');
const ResetPasswordPage = page(authP, 'ResetPasswordPage');
const AccountPage = page(account, 'AccountPage');
const DemoInboxPage = page(account, 'DemoInboxPage');
const StaticPage = page(account, 'StaticPage');
const NotFoundPage = page(account, 'NotFoundPage');
const AdminLayout = page(adminLayout, 'AdminLayout');
const AdminDashboard = page(adminLayout, 'AdminDashboard');
const AdminProducts = page(adminCatalog, 'AdminProducts');
const AdminProductEdit = page(adminCatalog, 'AdminProductEdit');
const AdminCategories = page(adminCatalog, 'AdminCategories');
const AdminOrders = page(adminOps, 'AdminOrders');
const AdminOrderDetail = page(adminOps, 'AdminOrderDetail');
const AdminInventory = page(adminOps, 'AdminInventory');
const AdminCustomers = page(adminOps, 'AdminCustomers');
const AdminRefunds = page(adminOps, 'AdminRefunds');
const AdminCoupons = page(adminMarketing, 'AdminCoupons');
const AdminReviews = page(adminMarketing, 'AdminReviews');
const AdminReports = page(adminMarketing, 'AdminReports');
const AdminSettings = page(adminMarketing, 'AdminSettings');
const AdminAudit = page(adminMarketing, 'AdminAudit');

const Loading = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Spinner className="size-8" />
  </div>
);
const s = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

/** UX guard only: every protected endpoint is enforced by the API. */
function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { status, user } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated') return <Navigate to={`/login?from=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (admin && !isAdmin(user)) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Admins only" action={<ButtonLink to="/">Back to the store</ButtonLink>}>Your account does not have access to the admin dashboard.</EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}

function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unexpected error';
  return (
    <div className="container-page py-16">
      <EmptyState title="Something went wrong on this page" action={<ButtonLink to="/">Go to the home page</ButtonLink>}>{message}</EmptyState>
    </div>
  );
}

const routes: RouteObject[] = [
  {
    element: <StoreLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: s(<HomePage />) },
      { path: 'products', element: s(<ProductsPage />) },
      { path: 'c/:slug', element: s(<ProductsPage />) },
      { path: 'p/:slug', element: s(<ProductPage />) },
      { path: 'cart', element: s(<CartPage />) },
      { path: 'checkout', element: s(<RequireAuth><CheckoutPage /></RequireAuth>) },
      { path: 'orders', element: s(<RequireAuth><OrdersPage /></RequireAuth>) },
      { path: 'orders/:orderNumber', element: s(<RequireAuth><OrderPage /></RequireAuth>) },
      { path: 'wishlist', element: s(<RequireAuth><WishlistPage /></RequireAuth>) },
      { path: 'account', element: s(<RequireAuth><AccountPage /></RequireAuth>) },
      { path: 'login', element: s(<LoginPage />) },
      { path: 'register', element: s(<RegisterPage />) },
      { path: 'forgot-password', element: s(<ForgotPasswordPage />) },
      { path: 'reset-password', element: s(<ResetPasswordPage />) },
      { path: 'demo/inbox', element: s(<DemoInboxPage />) },
      { path: 'pages/:slug', element: s(<StaticPage />) },
      { path: '*', element: s(<NotFoundPage />) },
    ],
  },
  {
    path: 'admin',
    element: s(<RequireAuth admin><AdminLayout /></RequireAuth>),
    errorElement: <RouteError />,
    children: [
      { index: true, element: s(<AdminDashboard />) },
      { path: 'orders', element: s(<AdminOrders />) },
      { path: 'orders/:orderNumber', element: s(<AdminOrderDetail />) },
      { path: 'products', element: s(<AdminProducts />) },
      { path: 'products/new', element: s(<AdminProductEdit />) },
      { path: 'products/:id', element: s(<AdminProductEdit />) },
      { path: 'categories', element: s(<AdminCategories />) },
      { path: 'inventory', element: s(<AdminInventory />) },
      { path: 'customers', element: s(<AdminCustomers />) },
      { path: 'coupons', element: s(<AdminCoupons />) },
      { path: 'reviews', element: s(<AdminReviews />) },
      { path: 'refunds', element: s(<AdminRefunds />) },
      { path: 'reports', element: s(<AdminReports />) },
      { path: 'settings', element: s(<AdminSettings />) },
      { path: 'audit', element: s(<AdminAudit />) },
    ],
  },
];

export const router = createBrowserRouter(routes);
