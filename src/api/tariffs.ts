import apiClient from './client';

// Types
export interface PeriodPrice {
  days: number;
  price_kopeks: number;
  price_rubles?: number;
}

export interface ServerTrafficLimit {
  traffic_limit_gb: number;
}

export interface ServerInfo {
  id: number;
  squad_uuid: string;
  display_name: string;
  country_code: string | null;
  is_selected: boolean;
  traffic_limit_gb?: number | null;
}

export interface PromoGroupInfo {
  id: number;
  name: string;
  is_selected: boolean;
}

export interface TariffListItem {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  is_trial_available: boolean;
  show_in_gift: boolean;
  is_daily: boolean;
  daily_price_kopeks: number;
  traffic_limit_gb: number;
  device_limit: number;
  tier_level: number;
  display_order: number;
  servers_count: number;
  subscriptions_count: number;
  created_at: string;
}

export interface TariffListResponse {
  tariffs: TariffListItem[];
  total: number;
}

export interface TariffDetail {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  is_trial_available: boolean;
  show_in_gift: boolean;
  traffic_limit_gb: number;
  device_limit: number;
  device_price_kopeks: number | null;
  max_device_limit: number | null;
  device_purchase_options: number[] | null;
  pricing_revision: number;
  tier_level: number;
  display_order: number;
  period_prices: PeriodPrice[];
  allowed_squads: string[];
  server_traffic_limits: Record<string, ServerTrafficLimit>;
  servers: ServerInfo[];
  promo_groups: PromoGroupInfo[];
  subscriptions_count: number;
  // Произвольное количество дней
  custom_days_enabled: boolean;
  price_per_day_kopeks: number;
  min_days: number;
  max_days: number;
  // Произвольный трафик при покупке
  custom_traffic_enabled: boolean;
  traffic_price_per_gb_kopeks: number;
  min_traffic_gb: number;
  max_traffic_gb: number;
  // Докупка трафика
  traffic_topup_enabled: boolean;
  traffic_topup_packages: Record<string, number>;
  max_topup_traffic_gb: number;
  // Дневной тариф
  is_daily: boolean;
  daily_price_kopeks: number;
  // Режим сброса трафика
  traffic_reset_mode: string | null; // 'DAY', 'WEEK', 'MONTH', 'MONTH_ROLLING', 'NO_RESET', null = глобальная настройка
  // Внешний сквад Remnawave
  external_squad_uuid: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TariffCreateRequest {
  name: string;
  description?: string;
  is_active?: boolean;
  show_in_gift?: boolean;
  traffic_limit_gb?: number;
  device_limit?: number;
  device_price_kopeks?: number;
  max_device_limit?: number;
  device_purchase_options?: number[] | null;
  tier_level?: number;
  period_prices?: PeriodPrice[];
  allowed_squads?: string[];
  server_traffic_limits?: Record<string, ServerTrafficLimit>;
  promo_group_ids?: number[];
  // Произвольное количество дней
  custom_days_enabled?: boolean;
  price_per_day_kopeks?: number;
  min_days?: number;
  max_days?: number;
  // Произвольный трафик при покупке
  custom_traffic_enabled?: boolean;
  traffic_price_per_gb_kopeks?: number;
  min_traffic_gb?: number;
  max_traffic_gb?: number;
  // Докупка трафика
  traffic_topup_enabled?: boolean;
  traffic_topup_packages?: Record<string, number>;
  max_topup_traffic_gb?: number;
  // Дневной тариф
  is_daily?: boolean;
  daily_price_kopeks?: number;
  // Режим сброса трафика
  traffic_reset_mode?: string | null;
  // Внешний сквад Remnawave
  external_squad_uuid?: string | null;
}

export interface ExternalSquadInfo {
  uuid: string;
  name: string;
  members_count: number;
}

export interface PublicLocationInfo {
  id: string;
  iso_code: string;
  label_ru: string;
  label_en: string;
  flag: string | null;
  lifecycle: 'draft' | 'ready' | 'published' | 'deprecated' | 'retired';
  visibility: 'hidden' | 'visible';
  health: 'unknown' | 'healthy' | 'unhealthy';
  tariff_assignable: boolean;
  selected?: boolean;
}

export interface EntitlementPlanPreview {
  plan_id: string;
  state: 'previewed' | 'confirmed_execution_disabled';
  plan_hash: string;
  manifest_hash: string;
  affected_subscription_count: number;
  execution_enabled: false;
}

export interface EntitlementPlanConfirmation {
  plan_id: string;
  state: 'confirmed_execution_disabled';
  plan_hash: string;
  execution_enabled: false;
}

export interface TariffUpdateRequest {
  name?: string;
  description?: string;
  is_active?: boolean;
  show_in_gift?: boolean;
  traffic_limit_gb?: number;
  device_limit?: number;
  device_price_kopeks?: number;
  max_device_limit?: number;
  device_purchase_options?: number[] | null;
  tier_level?: number;
  display_order?: number;
  period_prices?: PeriodPrice[];
  allowed_squads?: string[];
  server_traffic_limits?: Record<string, ServerTrafficLimit>;
  promo_group_ids?: number[];
  // Произвольное количество дней
  custom_days_enabled?: boolean;
  price_per_day_kopeks?: number;
  min_days?: number;
  max_days?: number;
  // Произвольный трафик при покупке
  custom_traffic_enabled?: boolean;
  traffic_price_per_gb_kopeks?: number;
  min_traffic_gb?: number;
  max_traffic_gb?: number;
  // Докупка трафика
  traffic_topup_enabled?: boolean;
  traffic_topup_packages?: Record<string, number>;
  max_topup_traffic_gb?: number;
  // Дневной тариф
  is_daily?: boolean;
  daily_price_kopeks?: number;
  // Режим сброса трафика
  traffic_reset_mode?: string | null;
  // Внешний сквад Remnawave
  external_squad_uuid?: string | null;
}

export interface TariffToggleResponse {
  id: number;
  is_active: boolean;
  message: string;
}

export interface TariffTrialResponse {
  id: number;
  is_trial_available: boolean;
  message: string;
}

export interface TariffStats {
  id: number;
  name: string;
  subscriptions_count: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  revenue_kopeks: number;
  revenue_rubles: number;
}

export const tariffsApi = {
  // Get all tariffs
  getTariffs: async (includeInactive = true): Promise<TariffListResponse> => {
    const response = await apiClient.get('/cabinet/admin/tariffs', {
      params: { include_inactive: includeInactive },
    });
    return response.data;
  },

  // Get single tariff
  getTariff: async (tariffId: number): Promise<TariffDetail> => {
    const response = await apiClient.get(`/cabinet/admin/tariffs/${tariffId}`);
    return response.data;
  },

  // Create new tariff
  createTariff: async (data: TariffCreateRequest): Promise<TariffDetail> => {
    const response = await apiClient.post('/cabinet/admin/tariffs', data);
    return response.data;
  },

  // Update tariff
  updateTariff: async (tariffId: number, data: TariffUpdateRequest): Promise<TariffDetail> => {
    const response = await apiClient.put(`/cabinet/admin/tariffs/${tariffId}`, data);
    return response.data;
  },

  // Delete tariff
  deleteTariff: async (
    tariffId: number,
  ): Promise<{ message: string; affected_subscriptions: number }> => {
    const response = await apiClient.delete(`/cabinet/admin/tariffs/${tariffId}`);
    return response.data;
  },

  // Toggle tariff active status
  toggleTariff: async (tariffId: number): Promise<TariffToggleResponse> => {
    const response = await apiClient.post(`/cabinet/admin/tariffs/${tariffId}/toggle`);
    return response.data;
  },

  // Toggle trial status
  toggleTrial: async (tariffId: number): Promise<TariffTrialResponse> => {
    const response = await apiClient.post(`/cabinet/admin/tariffs/${tariffId}/trial`);
    return response.data;
  },

  // Get tariff stats
  getTariffStats: async (tariffId: number): Promise<TariffStats> => {
    const response = await apiClient.get(`/cabinet/admin/tariffs/${tariffId}/stats`);
    return response.data;
  },

  // Update tariff display order
  updateOrder: async (tariffIds: number[]): Promise<void> => {
    await apiClient.put('/cabinet/admin/tariffs/order', { tariff_ids: tariffIds });
  },

  // Get available servers for selection
  getAvailableServers: async (): Promise<ServerInfo[]> => {
    const response = await apiClient.get('/cabinet/admin/tariffs/available-servers');
    return response.data;
  },

  // Product-facing catalog: intentionally contains no RemnaWave UUIDs.
  getPublicLocationCatalog: async (): Promise<PublicLocationInfo[]> => {
    const response = await apiClient.get('/cabinet/admin/public-locations/catalog');
    return response.data.locations;
  },

  getTariffLocationPolicy: async (
    tariffId: number,
  ): Promise<{ mode: string; policy_revision: number; locations: PublicLocationInfo[] }> => {
    const response = await apiClient.get(`/cabinet/admin/tariffs/${tariffId}/locations`);
    return response.data;
  },

  replaceTariffLocationPolicy: async (
    tariffId: number,
    locationIds: string[],
    reason: string,
  ): Promise<{ tariff_id: number; mode: string; policy_revision: number }> => {
    const response = await apiClient.put(`/cabinet/admin/tariffs/${tariffId}/locations`, {
      location_ids: locationIds,
      reason,
    });
    return response.data;
  },

  prepareTariffLocationPlan: async (
    tariffId: number,
    locationIds: string[],
    reason: string,
  ): Promise<EntitlementPlanPreview> => {
    const response = await apiClient.post(
      `/cabinet/admin/tariffs/${tariffId}/locations/prepare-plan`,
      {
        location_ids: locationIds,
        reason,
      },
    );
    return response.data;
  },

  confirmTariffLocationPlan: async (
    tariffId: number,
    planId: string,
    planHash: string,
    reason: string,
  ): Promise<EntitlementPlanConfirmation> => {
    const response = await apiClient.post(
      `/cabinet/admin/tariffs/${tariffId}/locations/plans/${planId}/confirm`,
      { plan_hash: planHash, reason },
    );
    return response.data;
  },

  // Get available promo groups for selection
  getAvailablePromoGroups: async (): Promise<{ id: number; name: string }[]> => {
    const response = await apiClient.get('/cabinet/admin/payment-methods/promo-groups');
    return response.data;
  },

  // Get available external squads from Remnawave
  getAvailableExternalSquads: async (): Promise<ExternalSquadInfo[]> => {
    const response = await apiClient.get('/cabinet/admin/tariffs/available-external-squads');
    return response.data;
  },
};
