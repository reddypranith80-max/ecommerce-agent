import { Router } from 'express';
import mongoose from 'mongoose';
import * as admin from '../controllers/admin.controller';
import * as authC from '../controllers/auth.controller';
import * as gateway from '../controllers/gateway.controller';
import * as store from '../controllers/store.controller';
import { authenticate, optionalAuth, requirePermission } from '../middleware/auth';
import { imageUpload, limits, requireSameOrigin } from '../middleware/common';

export function apiRouter(): Router {
  const r = Router();

  // ---- health
  r.get('/health/live', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });
  r.get('/health/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ready' : 'not_ready' } });
  });

  // ---- auth & account
  r.post('/auth/register', limits.register, authC.register);
  r.post('/auth/login', limits.loginIp, limits.loginEmail, authC.login);
  r.post('/auth/refresh', requireSameOrigin, authC.refresh);
  r.post('/auth/logout', requireSameOrigin, authC.logout);
  r.post('/auth/forgot-password', limits.forgotIp, limits.forgotEmail, authC.forgotPassword);
  r.post('/auth/reset-password', limits.reset, authC.resetPassword);

  r.get('/me', authenticate, authC.me);
  r.patch('/me', authenticate, authC.updateMe);
  r.post('/me/password', authenticate, authC.changePassword);
  r.get('/me/addresses', authenticate, authC.listAddresses);
  r.post('/me/addresses', authenticate, authC.createAddress);
  r.patch('/me/addresses/:id', authenticate, authC.updateAddress);
  r.delete('/me/addresses/:id', authenticate, authC.deleteAddress);
  r.post('/me/addresses/:id/default', authenticate, authC.setDefaultAddress);

  // ---- storefront
  r.get('/config', store.config);
  r.get('/home', store.home);
  r.get('/home/recommended', authenticate, store.recommended);
  r.get('/categories', store.categories);
  r.get('/categories/:slug', store.category);
  r.get('/products', limits.search, store.products);
  r.get('/products/suggest', limits.search, store.suggest);
  r.post('/products/cards', store.cards);
  r.get('/products/:slug', store.product);
  r.get('/products/:slug/related', store.related);
  r.get('/products/:slug/reviews', store.productReviews);
  r.get('/products/:slug/reviews/eligibility', authenticate, store.reviewEligibility);
  r.post('/products/:slug/reviews', authenticate, limits.reviews, store.createReview);
  r.patch('/reviews/:id', authenticate, limits.reviews, store.updateReview);
  r.delete('/reviews/:id', authenticate, store.deleteReview);

  // ---- cart & wishlist
  r.post('/cart/preview', store.previewCart);
  r.get('/cart', authenticate, store.getCart);
  r.post('/cart/items', authenticate, store.addCartItem);
  r.patch('/cart/items/:itemId', authenticate, store.updateCartItem);
  r.delete('/cart/items/:itemId', authenticate, store.removeCartItem);
  r.delete('/cart', authenticate, store.clearCart);
  r.post('/cart/merge', authenticate, store.mergeCart);
  r.get('/wishlist', authenticate, store.wishlist);
  r.get('/wishlist/ids', authenticate, store.wishlistIds);
  r.put('/wishlist/:productId', authenticate, store.addWishlist);
  r.delete('/wishlist/:productId', authenticate, store.removeWishlist);

  // ---- checkout, orders, payments
  r.post('/checkout/quote', authenticate, store.checkoutQuote);
  r.post('/orders', authenticate, limits.placeOrder, store.placeOrder);
  r.get('/orders', authenticate, store.myOrders);
  r.get('/orders/:orderNumber', authenticate, store.myOrder);
  r.post('/orders/:orderNumber/payment', authenticate, limits.payment, store.startPayment);
  r.post('/orders/:orderNumber/cancel', authenticate, store.cancelMyOrder);
  r.post('/payments/verify', authenticate, limits.payment, store.verifyPayment);

  // ---- simulated payment gateway (stands in for Razorpay's hosted checkout) & demo inbox
  r.get('/demopay/checkout/:gatewayOrderId', limits.gateway, gateway.checkoutSession);
  r.post('/demopay/checkout/:gatewayOrderId/pay', limits.gateway, gateway.checkoutPay);
  r.get('/demo/inbox', optionalAuth, gateway.demoInbox);

  // ---- admin
  const a = Router();
  a.use(authenticate);
  a.get('/dashboard', requirePermission('reports:read'), admin.dashboard);
  a.get('/reports/sales', requirePermission('reports:read'), admin.salesReport);

  a.get('/categories', requirePermission('catalog:write'), admin.categories);
  a.post('/categories', requirePermission('catalog:write'), admin.createCategory);
  a.patch('/categories/:id', requirePermission('catalog:write'), admin.updateCategory);
  a.delete('/categories/:id', requirePermission('catalog:write'), admin.deleteCategory);
  a.get('/products', requirePermission('catalog:write'), admin.products);
  a.post('/products', requirePermission('catalog:write'), admin.createProduct);
  a.get('/products/:id', requirePermission('catalog:write'), admin.product);
  a.patch('/products/:id', requirePermission('catalog:write'), admin.updateProduct);
  a.delete('/products/:id', requirePermission('catalog:write'), admin.deleteProduct);
  a.post('/media', requirePermission('catalog:write'), imageUpload, admin.uploadMedia);

  a.get('/inventory', requirePermission('inventory:write'), admin.inventory);
  a.post('/inventory/:sku/adjust', requirePermission('inventory:write'), admin.adjustInventory);
  a.patch('/inventory/:sku', requirePermission('inventory:write'), admin.setThreshold);
  a.get('/inventory/:sku/movements', requirePermission('inventory:write'), admin.movements);

  a.get('/orders', requirePermission('orders:write'), admin.orderList);
  a.get('/orders/:orderNumber', requirePermission('orders:write'), admin.orderDetail);
  a.post('/orders/:orderNumber/status', requirePermission('orders:write'), admin.orderStatus);
  a.post('/orders/:orderNumber/cancel', requirePermission('orders:write'), admin.cancelOrder);
  a.post('/orders/:orderNumber/review', requirePermission('orders:write'), admin.resolveReview);
  a.get('/refunds', requirePermission('orders:write'), admin.refunds);
  a.post('/refunds/:id/retry', requirePermission('orders:write'), admin.retryRefundHandler);

  a.get('/customers', requirePermission('customers:write'), admin.customers);
  a.get('/customers/:id', requirePermission('customers:write'), admin.customer);
  a.patch('/customers/:id', requirePermission('customers:write'), admin.customerStatus);

  a.get('/coupons', requirePermission('coupons:write'), admin.coupons);
  a.post('/coupons', requirePermission('coupons:write'), admin.createCoupon);
  a.patch('/coupons/:id', requirePermission('coupons:write'), admin.updateCoupon);
  a.delete('/coupons/:id', requirePermission('coupons:write'), admin.deleteCoupon);
  a.get('/coupons/:id/redemptions', requirePermission('coupons:write'), admin.couponRedemptions);

  a.get('/reviews', requirePermission('reviews:moderate'), admin.reviewList);
  a.patch('/reviews/:id', requirePermission('reviews:moderate'), admin.moderateReview);
  a.delete('/reviews/:id', requirePermission('reviews:moderate'), admin.deleteReview);

  a.get('/settings', requirePermission('settings:write'), admin.settings);
  a.patch('/settings', requirePermission('settings:write'), admin.saveSettings);
  a.get('/audit-logs', requirePermission('audit:read'), admin.auditLogs);
  a.post('/demo/gateway-outage', requirePermission('settings:write'), admin.simulateGatewayOutage);

  r.use('/admin', a);
  return r;
}
