// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecentPaymentsResponse } from '../api/admin';
import ru from '../locales/ru.json';
import AdminDashboard from './AdminDashboard';

const api = vi.hoisted(() => {
  // версия кабинета подставляется сборкой (vite define); в тестовой среде её нет
  (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test';
  return {
    getDashboardStats: vi.fn(),
    getTopReferrers: vi.fn(),
    getTopCampaigns: vi.fn(),
    getRecentPayments: vi.fn(),
    getSystemInfo: vi.fn(),
    getDashboardMoney: vi.fn(),
    getDashboardReferrals: vi.fn(),
    restartNode: vi.fn(),
    toggleNode: vi.fn(),
  };
});

vi.mock('../api/admin', () => ({ statsApi: api }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
    formatWithCurrency: (value: number) => `${value} $`,
  }),
}));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));

beforeEach(() => {
  api.getDashboardStats.mockResolvedValue({
    nodes: { total_users_online: 3, online: 1, offline: 0, disabled: 0, total: 1, nodes: [] },
    subscriptions: { people_paying: 57, people_on_trial: 23, new_buyers_today: 0 },
  });
  api.getTopCampaigns.mockResolvedValue({ campaigns: [] });
  api.getTopReferrers.mockResolvedValue({
    by_earnings: [],
    by_invited: [],
    total_referrers: 0,
    total_referrals: 0,
    total_earnings_kopeks: 0,
  });
  api.getDashboardReferrals.mockRejectedValue(new Error('not needed here'));
  api.getSystemInfo.mockResolvedValue({
    bot_version: '1.0',
    python_version: '3.13',
    uptime_seconds: 60,
    users_total: 1,
    subscriptions_active: 1,
  });
  api.getDashboardMoney.mockResolvedValue({
    today_kopeks: 0,
    month_kopeks: 1000000,
    total_kopeks: 3000000,
    days: [],
    months: [{ month: '2026-09', kopeks: 1000000 }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage() {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AdminDashboard />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const plain = (element: HTMLElement) => (element.textContent ?? '').replace(/\u00a0/g, ' ');

/** Выдуманные люди и деньги (репозиторий публичный). */
const row = {
  user_id: 9101,
  telegram_id: 100000101,
  email: null,
  username: null,
  payment_method: 'platega',
  description: 'Пополнение через Platega (СБП (QR))',
  is_completed: true,
};

const newBot: RecentPaymentsResponse = {
  payments: [
    {
      ...row,
      id: 1,
      display_name: 'Оля Тестова',
      amount_kopeks: 13400,
      amount_rubles: 134,
      type: 'provider_receipt',
      type_display: 'Оплата картой',
      created_at: '2026-09-30T09:08:00+00:00',
      is_first: true,
      purpose: 'Оплата подписки картой: 1 месяц',
      campaign_name: 'Тест-канал',
    },
    {
      ...row,
      id: 2,
      user_id: 9102,
      display_name: 'Коля Тестов',
      amount_kopeks: 64900,
      amount_rubles: 649,
      type: 'deposit',
      type_display: 'Пополнение',
      created_at: '2026-09-30T21:30:00+00:00', // 00:30 МСК уже 01.10
      is_first: false,
      purpose: null,
      campaign_name: null,
    },
  ],
  total_count: 2,
  total_today_kopeks: 0,
  total_week_kopeks: 0,
  hidden_last_30d: { registration_bonuses: 412, balance_purchases: 37, manual_credits: 3 },
};

describe('AdminDashboard — «Последние оплаты» (ПЛ-1)', () => {
  it('with the new bot: first/repeat, what was bought, the ad and what was hidden', async () => {
    api.getRecentPayments.mockResolvedValue(newBot);

    const { container } = await renderPage();

    await waitFor(() => expect(screen.getByText('Последние оплаты')).toBeTruthy());
    const text = plain(container);
    expect(screen.getAllByText('Первая оплата').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Повторная оплата').length).toBeGreaterThan(0);
    expect(text).toContain('Оплата подписки картой: 1 месяц · из рекламы «Тест-канал»');
    expect(text).toContain('Пополнение баланса');
    expect(text).not.toContain('Пополнение баланса · из рекламы');
    expect(text).toContain(
      'За 30 дней не вошли в список: бонусы за регистрацию — 412, покупки с баланса — 37, ручные начисления — 3',
    );
    expect(text).not.toContain('Последние платежи');
    // старые подписи типа проводки при новом боте не показываются
    expect(text).not.toContain('Оплата картой');
    expect(text).not.toContain('{{');
    // время по Москве, как плитки денег на этом экране, а не в поясе телефона
    expect(text).toContain('01.10, 00:30');
    expect(api.getRecentPayments).toHaveBeenCalledWith(10);
    // метка — у своего человека: в таблице сразу за именем, в карточке — за суммой
    expect(text).toContain('Оля ТестоваПервая оплата134.00 ₽');
    expect(text).toContain('Коля ТестовПовторная оплата649.00 ₽');
    expect(text).toContain('Оля Тестова134.00 ₽Первая оплата');
    expect(screen.getByText('За что')).toBeTruthy();
  });

  it('with the old bot: no new fields — rows keep type and method, no hidden line', async () => {
    api.getRecentPayments.mockResolvedValue({
      payments: newBot.payments.map(
        ({ is_first: _f, purpose: _p, campaign_name: _c, ...legacy }) => legacy,
      ),
      total_count: 2,
      total_today_kopeks: 0,
      total_week_kopeks: 0,
    });

    const { container } = await renderPage();

    await waitFor(() => expect(screen.getByText('Последние оплаты')).toBeTruthy());
    const text = plain(container);
    expect(text).toContain('Оплата картой');
    expect(text).toContain('platega');
    expect(screen.queryByText('За что')).toBeNull();
    expect(text).not.toContain('Первая оплата');
    expect(text).not.toContain('За 30 дней не вошли в список');
  });
});
