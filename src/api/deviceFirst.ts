import apiClient from './client';
import {
  clearCreateIntentKeys,
  getOrCreateIntentKey,
  intentStorageKey,
  payIntentName,
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
    description?: string | null;
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
  // The quote TTL remains an internal checkout value. It is not necessarily a
  // payment deadline once an external invoice exists.
  expires_at: string;
  // Platega may omit a deadline for an otherwise verified PENDING invoice.
  // Optional for a short mixed-version deploy window.
  provider_invoice_expires_at?: string | null;
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

/**
 * The fused pay-time request: the full order (selection, funding and the
 * optimistic price token) travels in one mutation because no durable checkout
 * exists before the customer explicitly chooses to pay.
 * `expected_tariff_total_kopeks` must be the verbatim raw `price_kopeks` from
 * purchase-options — never rounded — or the server answers `reprice_required`.
 */
export interface DeviceFirstDirectCommitRequest {
  period_days: number;
  selected_device_limit: number;
  funding_mode: 'wallet' | 'platega';
  /** Strictly null for wallet; an available provider method for platega. */
  method_key: string | null;
  expected_tariff_total_kopeks: number;
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

/**
 * Pay-time variant of the intent POST. The server stores business errors
 * (4xx) under the idempotency key and replays them verbatim, so a definitive
 * 4xx answer must rotate the local key — otherwise e.g. `wallet_insufficient`
 * would be replayed forever even after a top-up. A retry with a fresh key is
 * still safe: the per-user fence plus same-config resume resolve it to the
 * same checkout. Ambiguous failures (network loss, 5xx) keep the key so the
 * retry remains a true idempotent replay/re-entry.
 */
async function postPayIntent<T>(intent: string, url: string, body: unknown): Promise<T> {
  try {
    return await postIntent<T>(intent, url, body);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status !== undefined && status < 500) {
      sessionStorage.removeItem(intentStorageKey(intent));
    }
    throw error;
  }
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

  /**
   * Fused pay-time mutations: the order is born only now, at «Pay». The
   * checkout-scoped commit/native-launch above stay for legacy bundles and
   * for checkouts restored from old links; the new UI always pays through
   * these top-level routes with the full selection plus the optimistic price.
   */
  payDirect: async (request: DeviceFirstDirectCommitRequest): Promise<DeviceFirstCommitResponse> =>
    postPayIntent(payIntentName(request), '/cabinet/device-first/commit', request),

  nativeLaunchDirect: async (
    request: DeviceFirstDirectCommitRequest,
  ): Promise<DeviceFirstCommitResponse> =>
    postPayIntent(payIntentName(request), '/cabinet/device-first/native-launch', request),

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

  // A provider invoice is not an ordinary local quote.  This distinct intent
  // fences a verified pending invoice from stale fulfilment while preserving
  // it for canonical provider reconciliation and a possible late wallet
  // credit.  The server owns all eligibility checks.
  abandon: async (checkoutId: string): Promise<DeviceFirstCheckout> =>
    postIntent(`abandon:${checkoutId}`, `/cabinet/device-first/checkout/${checkoutId}/abandon`, {}),

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
