// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopReferrersResponse } from '../api/admin';
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

/** Выдуманные люди и деньги (репозиторий публичный). */
const referrer = {
  user_id: 9001,
  telegram_id: 100000001,
  username: 'test_masha',
  email: null,
  display_name: 'Маша Тестова',
  invited_count: 8,
  invited_today: 0,
  invited_week: 1,
  invited_month: 2,
  earnings_today_kopeks: 0,
  earnings_week_kopeks: 4975,
  earnings_month_kopeks: 9950,
  earnings_total_kopeks: 289300,
};

const oldBotTop: TopReferrersResponse = {
  by_earnings: [referrer],
  by_invited: [referrer],
  total_referrers: 1,
  total_referrals: 8,
  total_earnings_kopeks: 289300,
};

const newBotTop: TopReferrersResponse = {
  ...oldBotTop,
  by_earnings: [{ ...referrer, paid_count: 3 }],
  by_invited: [{ ...referrer, paid_count: 3 }],
  period_totals: { today_kopeks: 4975, week_kopeks: 29800, month_kopeks: 153583 },
};

beforeEach(() => {
  api.getDashboardStats.mockResolvedValue({
    nodes: { total_users_online: 3, online: 1, offline: 0, disabled: 0, total: 1, nodes: [] },
    subscriptions: { people_paying: 57, people_on_trial: 23, new_buyers_today: 0 },
  });
  api.getTopCampaigns.mockResolvedValue({ campaigns: [] });
  api.getRecentPayments.mockResolvedValue({
    payments: [],
    total_count: 0,
    total_today_kopeks: 0,
    total_week_kopeks: 0,
  });
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

describe('AdminDashboard — приглашения и «Топ рефералов» (РЕФ-2)', () => {
  it('with the new bot: totals for all inviters by Moscow days and «заплатили N» in the rows', async () => {
    api.getTopReferrers.mockResolvedValue(newBotTop);
    api.getDashboardReferrals.mockResolvedValue({
      months: [
        {
          month: '2026-09',
          came: 12,
          trial: 8,
          paid_first: 2,
          money_kopeks: 614300,
          rewards_kopeks: 153583,
        },
      ],
      new_people_month: 508,
      money_month_kopeks: 2098700,
      came_pct: 2,
      money_pct: 29,
    });

    const { container } = await renderPage();

    await waitFor(() => expect(screen.getByText('Начислено всем пригласившим')).toBeTruthy());
    const text = plain(container);
    expect(text).toContain('Приглашения · по ссылке друга');
    expect(text).toContain('8 пригл. · заплатили 3');
    expect(text).toContain('Сегодня50 ₽');
    expect(text).toContain('7 дней298 ₽');
    expect(text).toContain('Этот месяц1 536 ₽');
    // «Этот месяц» под «Топом» и плитка «Начислено пригласившим» — одно число
    expect(text).toContain('Начислено пригласившим1 536 ₽');
  });

  it('with the old bot: no referrals route and no new fields — the page stays whole', async () => {
    api.getTopReferrers.mockResolvedValue(oldBotTop);
    api.getDashboardReferrals.mockRejectedValue(new Error('Request failed with status code 404'));

    const { container } = await renderPage();

    await waitFor(() => expect(screen.getByText('Не удалось загрузить приглашения')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Начислено всем пригласившим')).toBeTruthy());
    const text = plain(container);
    // соседние блоки на месте: деньги и «Топ»
    expect(text).toContain('Деньги · как в выписке Platega');
    expect(text).toContain('Маша Тестова');
    // итогов у старого бота нет — прочерк, а не сумма десяти строк вкладки
    expect(text).toContain('Сегодня—');
    expect(text).toContain('7 дней—');
    expect(text).toContain('Этот месяц—');
    expect(text).not.toContain('заплатили');
  });
});
