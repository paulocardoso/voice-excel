import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';

const PRO_ENTITLEMENT_ID = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID ?? 'pro';
const apiKey = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
});

let configuredUserId: string | undefined;

export type BillingOutcome = 'pro' | 'free' | 'preview';

export function isRevenueCatConfigured(): boolean {
  return Boolean(apiKey);
}

export async function configureBilling(userId?: string): Promise<BillingOutcome> {
  if (!apiKey || !userId) return 'preview';
  if (!configuredUserId) {
    Purchases.configure({ apiKey, appUserID: userId });
    configuredUserId = userId;
  } else if (configuredUserId !== userId) {
    await Purchases.logIn(userId);
    configuredUserId = userId;
  }
  return planFromCustomerInfo(await Purchases.getCustomerInfo());
}

export async function purchasePro(userId?: string): Promise<BillingOutcome> {
  if (!apiKey || !userId) return 'preview';
  await configureBilling(userId);
  const offerings = await Purchases.getOfferings();
  const packageToPurchase = offerings.current?.availablePackages[0];
  if (!packageToPurchase) throw new Error('No subscription offer is available. Configure a current RevenueCat offering.');
  const result = await Purchases.purchasePackage(packageToPurchase);
  return planFromCustomerInfo(result.customerInfo);
}

export async function restorePro(userId?: string): Promise<BillingOutcome> {
  if (!apiKey || !userId) return 'preview';
  await configureBilling(userId);
  return planFromCustomerInfo(await Purchases.restorePurchases());
}

function planFromCustomerInfo(customerInfo: { entitlements: { active: Record<string, unknown> } }): BillingOutcome {
  return customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] ? 'pro' : 'free';
}
