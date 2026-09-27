import apiClient from './client';

// ============ Period ============

/** Кнопка периода. Окно считает сервер в сутках по Москве, а не кабинет по часам телефона (СП-1). */
export type SalesPeriodName =
  | 'yesterday'
  | 'this_month'
  | 'last_month'
  | '7d'
  | '30d'
  | '90d'
  | 'all'
  | 'custom';

export interface SalesPeriodParams {
  period: SalesPeriodName;
  /** Для `custom`: первый и последний день включительно, `YYYY-MM-DD`, сутки МСК. */
  start_date?: string;
  end_date?: string;
}

// ============ Overview (договор — `admin_sales_stats.py`, сторож `test_response_contracts_with_the_cabinet`) ============

export interface SalesWindow {
  start: string;
  end: string;
  previous_start: string | null;
  previous_end: string | null;
}

export interface SalesOverview {
  generated_at: string;
  window: SalesWindow;
  now: {
    paying: number;
    on_trial: number;
    ending_soon: number;
  };
  money: {
    received_kopeks: number;
    deposits_count: number;
    receipts_count: number;
    previous_received_kopeks: number | null;
    previous_comparable: boolean;
  };
  purchases: {
    count: number;
    amount_kopeks: number;
    first_count: number;
    first_amount_kopeks: number;
    first_after_trial: number;
    first_direct: number;
    renewal_count: number;
    renewal_amount_kopeks: number;
    addon_count: number;
    addon_amount_kopeks: number;
    previous_first_count: number | null;
    not_renewed: number;
  };
  trial: {
    came: number;
    took_trial: number;
    trial_finished: number;
    bought_after_trial: number;
  };
}

export type SalesPeopleKind = 'not_renewed' | 'ending_soon';

export interface SalesPerson {
  user_id: number;
  name: string | null;
  username: string | null;
  telegram_id: number | null;
  tariff_name: string | null;
  end_date: string;
  autopay_enabled: boolean;
  balance_kopeks: number;
}

export interface SalesPeople {
  kind: SalesPeopleKind;
  total: number;
  items: SalesPerson[];
}

export interface SalesAdCampaign {
  campaign_id: number;
  name: string;
  ad_spend_kopeks: number;
  buyers: number;
  cost_per_buyer_kopeks: number | null;
  receipts_kopeks: number;
  fresh: boolean;
}

export interface SalesAds {
  campaigns_total: number;
  campaigns_with_spend: number;
  mature_spend_kopeks: number;
  mature_buyers: number;
  mature_cost_per_buyer_kopeks: number | null;
  mature_receipts_kopeks: number;
  fresh_spend_kopeks: number;
  fresh_buyers: number;
  campaigns: SalesAdCampaign[];
}

// ============ Payments ============

export interface GatewaySuccessItem {
  method: string;
  total: number;
  paid: number;
  success_rate: number;
}

export interface PaymentHealth {
  total_attempts: number;
  total_paid: number;
  success_rate: number;
  failed_purchases: number;
  by_gateway: GatewaySuccessItem[];
}

// ============ API ============

export const salesStatsApi = {
  getOverview: async (params: SalesPeriodParams): Promise<SalesOverview> => {
    const response = await apiClient.get('/cabinet/admin/stats/sales/overview', { params });
    return response.data;
  },

  /** Без `params` — список «Кончится»: он считается от «сейчас» и периода не требует. */
  getPeople: async (kind: SalesPeopleKind, params?: SalesPeriodParams): Promise<SalesPeople> => {
    const response = await apiClient.get('/cabinet/admin/stats/sales/people', {
      params: { kind, ...params },
    });
    return response.data;
  },

  getAds: async (): Promise<SalesAds> => {
    const response = await apiClient.get('/cabinet/admin/stats/sales/ads');
    return response.data;
  },

  getPaymentHealth: async (params: SalesPeriodParams): Promise<PaymentHealth> => {
    const response = await apiClient.get('/cabinet/admin/stats/sales/payment-health', { params });
    return response.data;
  },
};
