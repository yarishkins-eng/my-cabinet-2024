// @vitest-environment jsdom

import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { PlatformProvider } from '../platform';
import { subscriptionApi } from '../api/subscription';
import { balanceApi } from '../api/balance';
import { deviceFirstApi, type DeviceFirstOptions } from '../api/deviceFirst';
import type {
  Subscription,
  SubscriptionStatusResponse,
  SubscriptionsListResponse,
  TariffsPurchaseOptions,
} from '../types';
import DashboardUnified from './DashboardUnified';
import SubscriptionPurchase from './SubscriptionPurchase';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'ru', resolvedLanguage: 'ru' },
  }),
}));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), currencySymbol: '₽' }),
}));
vi.mock('../hooks/useTrafficRefresh', () => ({
  useTrafficRefresh: () => ({ trafficData: null, trafficRefreshCooldown: 0 }),
}));
vi.mock('../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pullDistance: 0, refreshing: false }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: { telegram_id: 1, first_name: 'Tester', username: 'tester' },
      refreshUser: vi.fn(),
    }),
}));
vi.mock('../store/successNotification', () => ({
  useSuccessNotification: (selector: (state: unknown) => unknown) => selector({ isOpen: false }),
  useCloseOnSuccessNotification: vi.fn(),
}));
vi.mock('../components/home/PromoDiscountBanner', () => ({ default: () => null }));
// Payment controls are outside this navigation test. Both pages, the router and
// React Query remain real; this leaf only marks successful checkout admission.
vi.mock('../components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: () => <div data-testid="checkout-configurator" />,
}));

const subscription42: Subscription = {
  id: 42,
  status: 'expired',
  is_trial: false,
  start_date: '2026-07-01T12:00:00Z',
  end_date: '2026-08-01T12:00:00Z',
  days_left: 0,
  hours_left: 0,
  minutes_left: 0,
  time_left_display: '0',
  traffic_limit_gb: 0,
  traffic_used_gb: 0,
  traffic_used_percent: 0,
  device_limit: 4,
  connected_squads: ['de'],
  servers: [],
  autopay_enabled: false,
  autopay_days_before: 3,
  subscription_url: null,
  hide_subscription_link: false,
  is_active: false,
  is_expired: true,
  is_limited: false,
  in_grace: false,
  tariff_id: 3,
  tariff_name: 'Базовый',
  restriction_subscription: false,
  can_topup_devices: false,
  can_topup_traffic: false,
};
const subscription87: Subscription = {
  ...subscription42,
  id: 87,
  status: 'active',
  end_date: '2026-12-11T12:00:00Z',
  days_left: 60,
  is_active: true,
  is_expired: false,
};
const purchaseOptions: TariffsPurchaseOptions = {
  sales_mode: 'tariffs',
  tariffs: [],
  current_tariff_id: 3,
  balance_kopeks: 0,
  balance_label: '0 ₽',
};
const checkoutOptions: DeviceFirstOptions = {
  eligible: true,
  legacy_tariff_purchase_allowed: false,
  tariff: {
    id: 3,
    name: 'Базовый',
    traffic_limit_gb: 0,
    base_device_limit: 1,
    pricing_revision: 1,
  },
  device_options: [4],
  period_options: [30],
  default_period_days: 30,
  current_subscription: { id: 42, device_limit: 4, is_trial: false },
  balance_kopeks: 0,
  price_matrix: [
    {
      period_days: 30,
      prices: [
        {
          device_limit: 4,
          price_kopeks: 29900,
          breakdown: {
            base_price_kopeks: 14900,
            devices_price_kopeks: 15000,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
  ],
};

const clients: QueryClient[] = [];
const visitedPaths: string[] = [];
function LocationProbe() {
  const { pathname, search } = useLocation();
  const path = pathname + search;
  useEffect(() => {
    visitedPaths.push(path);
  }, [path]);
  return <output data-testid="location">{path}</output>;
}
function RenewalTarget() {
  return <output data-testid="renewal-target">{useParams().subscriptionId}</output>;
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  visitedPaths.length = 0;
  vi.restoreAllMocks();
});

describe('Home renewal preserves its target through checkout', () => {
  it.each(['mode-changed', 'steady-single'])(
    'keeps subscription42 and visits the checkout: %s',
    async (scenario) => {
      let leftHome = false;
      const changedMode = scenario === 'mode-changed';
      const getSubscription = vi
        .spyOn(subscriptionApi, 'getSubscription')
        .mockImplementation(async (id) => {
          // Home may still display its cached42 while the bootstrap refresh is
          // in flight. In multi-mode a later unqualified API read chooses87
          // (the backend's max(days_left)); an explicit42 always resolves42.
          if (!leftHome && id == null) return new Promise<SubscriptionStatusResponse>(() => {});
          const subscription =
            changedMode && leftHome && id == null ? subscription87 : subscription42;
          return { has_subscription: true, subscription };
        });
      vi.spyOn(subscriptionApi, 'getSubscriptions').mockImplementation(() =>
        changedMode
          ? new Promise<SubscriptionsListResponse>(() => {})
          : Promise.resolve({ subscriptions: [], multi_tariff_enabled: false }),
      );
      vi.spyOn(subscriptionApi, 'getDevices').mockResolvedValue({
        devices: [],
        total: 0,
        device_limit: 4,
        panel_ok: true,
      });
      vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(purchaseOptions);
      const getRenewal = vi.spyOn(subscriptionApi, 'getRenewalOptions').mockResolvedValue([
        {
          period_days: 30,
          price_kopeks: 29900,
          price_rubles: 299,
          discount_percent: 0,
          original_price_kopeks: null,
        },
      ]);
      vi.spyOn(balanceApi, 'getBalance').mockResolvedValue({
        balance_kopeks: 0,
        balance_rubles: 0,
      });
      vi.spyOn(deviceFirstApi, 'getOpen').mockRejectedValue({
        response: { status: 404, data: { detail: { code: 'no_open_checkout' } } },
      });
      vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue(
        changedMode
          ? {
              eligible: false,
              legacy_tariff_purchase_allowed: false,
              reason: 'eligible_tariff_count_not_one',
            }
          : checkoutOptions,
      );

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      clients.push(client);
      client.setQueryData(
        ['subscriptions-list'],
        {
          subscriptions: [],
          multi_tariff_enabled: false,
        },
        { updatedAt: Date.now() - 120_000 },
      );
      client.setQueryData(['subscription'], {
        has_subscription: true,
        subscription: subscription42,
      });
      render(
        <PlatformProvider>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/']}>
              <LocationProbe />
              <Routes>
                <Route path="/" element={<DashboardUnified />} />
                <Route path="/subscription/purchase" element={<SubscriptionPurchase />} />
                <Route path="/subscriptions/:subscriptionId/renew" element={<RenewalTarget />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </PlatformProvider>,
      );
      const renewButton = await screen.findByRole('button', { name: 'home.hero.renew' });
      expect(client.getQueryData(['subscription'])).toMatchObject({ subscription: { id: 42 } });
      const readsBeforeClick = getSubscription.mock.calls.length;
      leftHome = true;
      fireEvent.click(renewButton);

      if (changedMode) {
        expect((await screen.findByTestId('renewal-target')).textContent).toBe('42');
        expect(getRenewal).toHaveBeenCalledWith(42);
        expect(getRenewal).not.toHaveBeenCalledWith(87);
      } else {
        expect(await screen.findByTestId('checkout-configurator')).toBeTruthy();
        expect(screen.getByTestId('location').textContent).toBe(
          '/subscription/purchase?subscriptionId=42',
        );
        expect(getRenewal).not.toHaveBeenCalled();
      }
      await waitFor(() =>
        expect(visitedPaths).toContain('/subscription/purchase?subscriptionId=42'),
      );
      expect(getSubscription.mock.calls.slice(readsBeforeClick)).toContainEqual([42]);
    },
  );
});
