import apiClient from './client';
import {
  clearCreateIntentKeys,
  getOrCreateIntentKey,
  intentStorageKey,
} from './deviceFirstIdempotency';

export type DeviceFirstUiState =
  | 'configuration'
  | 'confirmation'
  | 'awaiting_payment'
  | 'processing'
  | 'provisioning'
  | 'ready'
  | 'reprice_required'
  | 'conflict'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'operator_review';

export interface DeviceFirstPrice {
  device_limit: number;
  price_kopeks: number;
  breakdown: {
    base_price_kopeks: number;
    devices_price_kopeks: number;
    promo_group_discount_kopeks: number;
    promo_offer_discount_kopeks: number;
  };
}

export interface DeviceFirstOptions {
  eligible: boolean;
  reason?: string;
  tariff?: {
    id: number;
    name: string;
    traffic_limit_gb: number;
    base_device_limit: number;
    pricing_revision: number;
  };
  device_options?: number[];
  period_options?: number[];
  default_period_days?: number;
  current_subscription?: { id: number; device_limit: number; is_trial: boolean } | null;
  balance_kopeks?: number;
  price_matrix?: Array<{ period_days: number; prices: DeviceFirstPrice[] }>;
}

export interface DeviceFirstCheckout {
  id: string;
  tariff_id: number;
  target_subscription_id: number | null;
  period_days: number;
  selected_device_limit: number;
  price_breakdown: DeviceFirstPrice['breakdown'];
  quoted_price_kopeks: number;
  max_price_kopeks: number;
  settlement_mode: 'legacy_deposit' | 'direct_purchase_v2';
  tariff_total_kopeks: number;
  wallet_applied_kopeks: number;
  external_payable_kopeks: number;
  funding_mode: 'wallet' | 'platega' | null;
  // Before an external method is chosen this is the quote TTL. Once Platega
  // returns a live invoice it is the provider-owned payment deadline.
  expires_at: string;
  lifecycle_state: string;
  funding_state: string;
  provisioning_state: string;
  terminal_reason: string | null;
  ui_state: DeviceFirstUiState;
  created_subscription_id: number | null;
  current_device_limit: number | null;
  // Optional while an older backend can still answer a resumed checkout.
  // Only an explicit false means that the previous paid limit may be shown.
  current_subscription_is_trial?: boolean | null;
  estimated_end_at: string;
  balance_kopeks: number | null;
  shortage_kopeks: number | null;
  top_up_surplus_kopeks: number | null;
}

export interface DeviceFirstPaymentAttempt {
  status: string;
  method_key: string;
  amount_kopeks: number;
  currency: string;
  redirect_url: string;
}

export interface DeviceFirstCommitResponse {
  checkout: DeviceFirstCheckout;
  /** Returned only by an authenticated owner command, never by checkout reads. */
  redirect_url?: string;
}

function intentKey(intent: string): string {
  return getOrCreateIntentKey(sessionStorage, intent, () => crypto.randomUUID());
}

async function postIntent<T>(intent: string, url: string, body: unknown): Promise<T> {
  const response = await apiClient.post(url, body, {
    headers: { 'Idempotency-Key': intentKey(intent) },
  });
  sessionStorage.removeItem(intentStorageKey(intent));
  return response.data as T;
}

export const deviceFirstApi = {
  getOptions: async (): Promise<DeviceFirstOptions> =>
    (await apiClient.get('/cabinet/device-first/purchase-options')).data,

  create: async (periodDays: number, selectedDeviceLimit: number): Promise<DeviceFirstCheckout> =>
    postIntent(`create:${periodDays}:${selectedDeviceLimit}`, '/cabinet/device-first/checkout', {
      period_days: periodDays,
      selected_device_limit: selectedDeviceLimit,
    }),

  clearCreateIntents: (): void => clearCreateIntentKeys(sessionStorage),

  getOpen: async (): Promise<DeviceFirstCheckout> =>
    (await apiClient.get('/cabinet/device-first/checkout/open')).data,

  get: async (checkoutId: string): Promise<DeviceFirstCheckout> =>
    (await apiClient.get(`/cabinet/device-first/checkout/${checkoutId}`)).data,

  confirm: async (checkoutId: string): Promise<DeviceFirstCheckout> =>
    postIntent(`confirm:${checkoutId}`, `/cabinet/device-first/checkout/${checkoutId}/confirm`, {}),

  arm: async (checkoutId: string): Promise<DeviceFirstCheckout> =>
    postIntent(`arm:${checkoutId}`, `/cabinet/device-first/checkout/${checkoutId}/arm`, {}),

  commit: async (
    checkoutId: string,
    fundingMode: 'wallet' | 'platega',
    methodKey?: string,
  ): Promise<DeviceFirstCommitResponse> =>
    postIntent(
      `commit:${checkoutId}:${fundingMode}:${methodKey ?? ''}`,
      `/cabinet/device-first/checkout/${checkoutId}/commit`,
      { funding_mode: fundingMode, ...(methodKey ? { method_key: methodKey } : {}) },
    ),

  nativeLaunch: async (checkoutId: string, methodKey: string): Promise<DeviceFirstCommitResponse> =>
    postIntent(
      `native-launch:${checkoutId}:${methodKey}`,
      `/cabinet/device-first/checkout/${checkoutId}/native-launch`,
      { method_key: methodKey },
    ),

  getPendingPayment: async (
    checkoutId: string,
  ): Promise<{ redirect_url: string | null; status: string; resume_allowed: boolean }> =>
    (await apiClient.get(`/cabinet/device-first/checkout/${checkoutId}/pending-payment`)).data,

  resumeInvoice: async (
    checkoutId: string,
    methodKey: string,
  ): Promise<DeviceFirstCommitResponse> =>
    postIntent(
      `resume-invoice:${checkoutId}:${methodKey}`,
      `/cabinet/device-first/checkout/${checkoutId}/resume-invoice`,
      { method_key: methodKey },
    ),

  cancel: async (checkoutId: string): Promise<DeviceFirstCheckout> =>
    postIntent(`cancel:${checkoutId}`, `/cabinet/device-first/checkout/${checkoutId}/cancel`, {}),

  paymentMethods: async (): Promise<{ methods: Array<{ key: string; provider_code: number }> }> =>
    (await apiClient.get('/cabinet/device-first/payment-methods')).data,

  createPaymentAttempt: async (
    checkoutId: string,
    methodKey: string,
  ): Promise<DeviceFirstPaymentAttempt> =>
    postIntent(
      `payment:${checkoutId}:${methodKey}`,
      `/cabinet/device-first/checkout/${checkoutId}/payment-attempt`,
      { method_key: methodKey },
    ),
};
