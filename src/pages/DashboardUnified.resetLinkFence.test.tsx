// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PlatformProvider } from '../platform';
import DashboardUnified from './DashboardUnified';

const resetEpoch = '2026-09-08T13:00:00+00:00';
const retiredUrl = 'https://example.invalid/retired-home-bearer';
let canonicalRefetchStarted = false;

const activeSubscription = {
  id: 42,
  status: 'active',
  is_active: true,
  is_expired: false,
  is_limited: false,
  is_trial: false,
  days_left: 30,
  hours_left: 720,
  traffic_limit_gb: 0,
  traffic_used_gb: 0,
  traffic_used_percent: 0,
  device_limit: 3,
  subscription_url: retiredUrl,
  hide_subscription_link: false,
  end_date: '2026-10-08T13:00:00+00:00',
  autopay_enabled: false,
  in_grace: false,
  restriction_subscription: false,
  can_topup_devices: false,
  can_topup_traffic: false,
  connected_squads: [],
  links: [],
  happ: null,
  grace_until: null,
  disabled_reason_hint: null,
};

vi.mock('../api/deviceFirst', () => ({ deviceFirstApi: { getOpen: () => Promise.resolve(null) } }));
vi.mock('../api/subscription', () => ({
  subscriptionApi: {
    // `/` is fresh and says reset history exists; `/42` intentionally begins from
    // a pre-reset cache and never resolves, reproducing the mount-time race.
    getSubscription: (id?: number) => {
      if (id != null) {
        canonicalRefetchStarted = true;
        return new Promise(() => undefined);
      }
      return Promise.resolve({
        subscription: activeSubscription,
        has_subscription: true,
        test_link_strict: true,
        test_reset_at: resetEpoch,
      });
    },
    getConnectionLink: () =>
      Promise.resolve({
        subscription_url: retiredUrl,
        display_link: retiredUrl,
        happ_redirect_link: null,
        happ_scheme_link: null,
        connect_mode: 'miniapp_custom',
        hide_link: false,
        instructions: { steps: [] },
      }),
    getSubscriptions: () => Promise.resolve({ subscriptions: [] }),
    getTrialInfo: () => Promise.resolve({ is_available: false }),
    getDevices: () => Promise.resolve({ devices: [], total: 0, panel_ok: true }),
    getPurchaseOptions: () => Promise.resolve({ multi_tariff_enabled: false }),
  },
}));
vi.mock('../api/balance', () => ({
  balanceApi: { getBalance: () => Promise.resolve({ balance_kopeks: 0 }) },
}));
vi.mock('../api/promo', () => ({
  promoApi: {
    getOffers: () => Promise.resolve([]),
    getActiveDiscount: () => Promise.resolve({ discount_percent: 0 }),
  },
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
  };
});
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), currencySymbol: '₽' }),
}));
vi.mock('../hooks/useTrafficRefresh', () => ({ useTrafficRefresh: () => ({}) }));
vi.mock('../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pullDistance: 0, isRefreshing: false }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { telegram_id: 1, first_name: 'krotop' }, refreshUser: vi.fn() }),
}));
vi.mock('../store/successNotification', () => ({
  useSuccessNotification: (selector: (state: unknown) => unknown) => selector({ isOpen: false }),
}));

afterEach(() => {
  cleanup();
  canonicalRefetchStarted = false;
});

describe('DashboardUnified reset-link fence', () => {
  it('does not expose a cached bearer while fresh bootstrap strict metadata waits for canonical status', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // This is the actual dangerous cache shape: the prior generation claims a
    // non-strict null epoch while the fresh bootstrap already says strict/e2.
    queryClient.setQueryData(['subscription', 42], {
      subscription: { ...activeSubscription, subscription_url: retiredUrl },
      has_subscription: true,
      test_link_strict: false,
      test_reset_at: null,
    });
    queryClient.invalidateQueries({ queryKey: ['subscription', 42] });

    render(
      <PlatformProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>
            <DashboardUnified />
          </MemoryRouter>
        </QueryClientProvider>
      </PlatformProvider>,
    );

    await waitFor(() => expect(canonicalRefetchStarted).toBe(true));
    await waitFor(() => expect(screen.getByText('dashboard.welcome')).toBeTruthy());
    expect(screen.queryByTitle(retiredUrl)).toBeNull();
    expect(screen.queryByRole('button', { name: 'home.link.copy' })).toBeNull();
  });
});
