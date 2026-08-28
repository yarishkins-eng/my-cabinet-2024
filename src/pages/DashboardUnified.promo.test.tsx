// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PlatformProvider } from '../platform';
import DashboardUnified from './DashboardUnified';

/**
 * 🔴 СТОРОЖ НА ПОДКЛЮЧЕНИЕ, а не на существование компонента.
 *
 * Ровно этим болел предшественник: блок `PromoOffersSection` был написан, покрыт кодом и
 * лежал в репозитории — но в СТАРОМ `Dashboard.tsx`, который с 24.06 не подключён к
 * маршрутам. Два месяца никто не замечал, что клиент не видит своих скидок; нашёл живой
 * проход владельца 28.08.
 *
 * Поэтому здесь монтируется НАСТОЯЩАЯ живая Главная (`DashboardUnified` — тот компонент,
 * что стоит на «/» в `App.tsx`), а не сам баннер. Тест на баннер в отдельности такую
 * поломку пережил бы молча.
 */

const OFFER = {
  id: 404,
  notification_type: 'expired_discount_wave2',
  discount_percent: 17,
  effect_type: 'percent_discount',
  expires_at: '2026-09-03T14:05:00Z',
  is_active: true,
  is_claimed: false,
  claimed_at: null,
  extra_data: null,
};

vi.mock('../api/promo', () => ({
  promoApi: {
    getOffers: () => Promise.resolve([OFFER]),
    getActiveDiscount: () =>
      Promise.resolve({ discount_percent: 0, source: null, expires_at: null, is_active: false }),
    claimOffer: () => Promise.resolve({ success: true, message: 'ok' }),
  },
}));
vi.mock('../api/deviceFirst', () => ({
  deviceFirstApi: { getOpen: () => Promise.resolve(null) },
}));
vi.mock('../api/subscription', () => ({
  subscriptionApi: {
    getSubscription: () => Promise.resolve({ subscription: null, has_subscription: false }),
    getSubscriptions: () => Promise.resolve({ subscriptions: [] }),
    getTrialInfo: () => Promise.resolve({ is_available: false }),
    getDevices: () => Promise.resolve({ devices: [] }),
    getPurchaseOptions: () => Promise.resolve({ multi_tariff_enabled: false }),
  },
}));
vi.mock('../api/balance', () => ({
  balanceApi: { getBalance: () => Promise.resolve({ balance_kopeks: 0 }) },
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: unknown) =>
        options && typeof options === 'object'
          ? `${key}|${Object.values(options as Record<string, unknown>).join(',')}`
          : key,
      i18n: { language: 'ru' },
    }),
  };
});
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (v: number) => v.toFixed(2), currencySymbol: '₽' }),
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

afterEach(() => cleanup());

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <PlatformProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <DashboardUnified />
        </MemoryRouter>
      </QueryClientProvider>
    </PlatformProvider>,
  );
}

describe('живая Главная показывает скидку клиента', () => {
  it('рисует баннер предложения на том экране, который реально стоит на «/»', async () => {
    renderHome();

    expect(await screen.findByText('promo.offers.discountPercent|17')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'promo.offers.activate' })).toBeTruthy();
  });

  it('показывает его и человеку БЕЗ подписки — крючок придуман ровно для ушедших', async () => {
    // Подписки нет (`has_subscription: false`). Встань баннер внутрь ветки «подписка есть»,
    // его не увидела бы как раз та половина людей, ради которой предложение и шлётся.
    renderHome();

    await waitFor(() => expect(screen.getByText('promo.offers.discountPercent|17')).toBeTruthy());
  });
});
