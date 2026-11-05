import type { PublicConfig, StoreSettings } from '@shop/shared';
import { env } from '../config/env';
import { Settings } from '../models/system.model';
import { conflict } from '../utils/errors';
import { audit, type Actor } from './audit.service';

export async function getSettings() {
  const existing = await Settings.findById('store');
  if (existing) return existing;
  try {
    return await Settings.create({ _id: 'store' });
  } catch {
    // Another request created it first.
    return (await Settings.findById('store'))!;
  }
}

export function toStoreSettings(s: Awaited<ReturnType<typeof getSettings>>): StoreSettings {
  return {
    version: s.__v ?? 0,
    storeName: s.storeName,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    codEnabled: s.codEnabled,
    codMaxOrderValue: s.codMaxOrderValue,
    codMaxOpenOrders: s.codMaxOpenOrders,
    shippingFlatFee: s.shippingFlatFee,
    freeShippingThreshold: s.freeShippingThreshold,
    paymentWindowMinutes: s.paymentWindowMinutes,
    paymentGraceMinutes: s.paymentGraceMinutes,
    defaultLowStockThreshold: s.defaultLowStockThreshold,
    heroTitle: s.heroTitle,
    heroSubtitle: s.heroSubtitle,
  };
}

export async function getPublicConfig(): Promise<PublicConfig> {
  const s = await getSettings();
  return {
    storeName: s.storeName,
    currency: 'INR',
    codEnabled: s.codEnabled,
    codMaxOrderValue: s.codMaxOrderValue,
    shippingFlatFee: s.shippingFlatFee,
    freeShippingThreshold: s.freeShippingThreshold,
    paymentWindowMinutes: s.paymentWindowMinutes,
    paymentKeyId: env.DEMOPAY_KEY_ID,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    demoMode: env.DEMO_MODE,
  };
}

export async function updateSettings(
  actor: Actor,
  input: Partial<Omit<StoreSettings, 'version'>> & { version: number },
): Promise<StoreSettings> {
  const s = await getSettings();
  if ((s.__v ?? 0) !== input.version) {
    throw conflict('STALE_VERSION', 'Settings were changed by someone else. Reload and try again.');
  }
  const { version: _v, ...changes } = input;
  s.set(changes);
  s.increment();
  await s.save();
  await audit(actor, 'settings.update', 'settings', 'store', Object.keys(changes).join(', '));
  return toStoreSettings(s);
}
