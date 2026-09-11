import axios from 'axios';
import apiClient from './client';

export interface DeviceAddonQuote {
  purchase_enabled?: boolean;
  subscription_id: number;
  devices_to_add: number;
  original_device_limit: number;
  new_device_limit: number;
  max_device_limit: number | null;
  included_free_devices: number;
  chargeable_devices: number;
  monthly_price_kopeks: number;
  base_price_kopeks: number;
  discount_percent: number;
  price_kopeks: number;
  balance_kopeks: number;
  missing_kopeks: number;
  days_left: number;
  end_date: string;
  quote_token: string;
  quote_expires_at: string;
}

export type DeviceAddonFulfillmentStatus = 'pending' | 'ready' | 'needs_attention';
export type DeviceAddonPurchaseState = 'draft' | 'purchased';
export type DeviceAddonTopupStatus =
  | 'prepared'
  | 'dispatching'
  | 'creation_unknown'
  | 'pending'
  | 'reconciling'
  | 'paid'
  | 'terminal'
  | 'operator_review';

export interface DeviceAddonReceipt {
  devices_added: number;
  new_device_limit: number;
  amount_paid_kopeks: number;
}

export interface DeviceAddonTopupAttempt {
  id: string;
  intent_id: string;
  requested_amount_kopeks: number;
  payment_method: 'platega';
  payment_option: string | null;
  /** Internal provider code is deliberately not exposed by the cabinet API. */
  provider_method_code?: number | null;
  status: DeviceAddonTopupStatus;
  credited_amount_kopeks: number | null;
  can_open_payment?: boolean;
  can_create_new_attempt?: boolean;
  action_required?: boolean;
}

export interface DeviceAddonTopupResponse {
  attempt: DeviceAddonTopupAttempt;
  /** Returned only by the protected POST response. It is never inferred from a URL status. */
  payment_url: string | null;
  return_start_param: string | null;
}

export interface DeviceAddonTopupReadResponse {
  attempt: DeviceAddonTopupAttempt;
  intent: Pick<DeviceAddonIntent, 'id' | 'purchase_state' | 'fulfillment_status'>;
  /** Owner-only, and only while the verified local invoice remains pending. */
  payment_url?: string | null;
}

export interface DeviceAddonIntent {
  id: string;
  subscription_id: number;
  devices_to_add: number;
  price_kopeks: number;
  purchase_state: DeviceAddonPurchaseState;
  receipt: DeviceAddonReceipt | null;
  fulfillment_status: DeviceAddonFulfillmentStatus | null;
  fulfillment_error_code: string | null;
  purchase_enabled?: boolean;
  topup_attempts: DeviceAddonTopupAttempt[];
  quote?: DeviceAddonQuote | null;
  quote_error?: { code?: string; message?: string } | null;
}

export interface DeviceAddonApiError {
  code?: string;
  message?: string;
  quote?: DeviceAddonQuote;
}

/** FastAPI wraps route errors in `detail`; keep the client compatible with it. */
export interface DeviceAddonApiErrorEnvelope {
  detail?: DeviceAddonApiError;
  code?: string;
  message?: string;
  quote?: DeviceAddonQuote;
}

export function getDeviceAddonError(error: unknown): DeviceAddonApiError | undefined {
  if (!axios.isAxiosError<DeviceAddonApiErrorEnvelope>(error)) return undefined;
  const payload = error.response?.data;
  return payload?.detail ?? payload;
}

export const deviceAddonApi = {
  getQuote: async (subscriptionId: number, devices: number): Promise<DeviceAddonQuote> =>
    (
      await apiClient.get<DeviceAddonQuote>('/cabinet/subscription/devices/quote', {
        params: { subscription_id: subscriptionId, devices },
      })
    ).data,

  createIntent: async (quoteToken: string, idempotencyKey: string): Promise<DeviceAddonIntent> =>
    (
      await apiClient.post<DeviceAddonIntent>('/cabinet/subscription/devices/intents', {
        quote_token: quoteToken,
        idempotency_key: idempotencyKey,
      })
    ).data,

  getIntent: async (intentId: string): Promise<DeviceAddonIntent> =>
    (
      await apiClient.get<DeviceAddonIntent>(
        `/cabinet/subscription/devices/intents/${encodeURIComponent(intentId)}`,
      )
    ).data,

  purchase: async (intentId: string, quoteToken: string): Promise<DeviceAddonIntent> =>
    (
      await apiClient.post<DeviceAddonIntent>(
        `/cabinet/subscription/devices/intents/${encodeURIComponent(intentId)}/purchase`,
        { quote_token: quoteToken },
      )
    ).data,

  createTopup: async (
    intentId: string,
    payload: {
      idempotency_key: string;
      expected_amount_kopeks: number;
      payment_method: 'platega';
      payment_option: string;
      return_surface: 'telegram' | 'cabinet';
    },
  ): Promise<DeviceAddonTopupResponse> =>
    (
      await apiClient.post<DeviceAddonTopupResponse>(
        `/cabinet/subscription/devices/intents/${encodeURIComponent(intentId)}/topup`,
        payload,
      )
    ).data,

  getTopup: async (attemptId: string): Promise<DeviceAddonTopupReadResponse> =>
    (
      await apiClient.get<DeviceAddonTopupReadResponse>(
        `/cabinet/subscription/devices/topups/${encodeURIComponent(attemptId)}`,
      )
    ).data,
};
