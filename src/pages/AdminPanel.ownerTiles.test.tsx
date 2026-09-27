// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ru from '../locales/ru.json';
import AdminPanel from './AdminPanel';

const stats = vi.hoisted(() => {
  // версия сборки подставляется Vite при сборке; в тесте её нет, а панель читает её при загрузке модуля
  (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test';
  return { getSystemInfo: vi.fn(), getDashboardStats: vi.fn() };
});
vi.mock('@/api/admin', () => ({ statsApi: stats }));
vi.mock('@/hooks/useTelegramSDK', () => ({
  useTelegramSDK: () => ({
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));
// без анимации счётчика — число сразу окончательное
vi.mock('@/hooks/useAnimatedNumber', () => ({ useAnimatedNumber: (value: number) => value }));

const subscriptions = {
  total: 140,
  active: 139,
  trial: 58,
  paid: 81,
  expired: 1,
  purchased_today: 5,
  purchased_week: 0,
  purchased_month: 0,
  trial_to_paid_conversion: 22.8,
};

async function renderPanel(extra: Record<string, unknown>) {
  stats.getSystemInfo.mockResolvedValue({ bot_version: '3.61.0', uptime_seconds: 100 });
  stats.getDashboardStats.mockResolvedValue({ subscriptions: { ...subscriptions, ...extra } });
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminPanel />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminPanel — верх панели по правилам владельца (СП-1)', () => {
  it('shows the same people as the «Пользователи» screen, not subscriptions with Team', async () => {
    await renderPanel({ people_on_trial: 37, people_paying: 68, new_buyers_today: 2 });

    expect((await screen.findAllByText('На пробном')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('37').length).toBeGreaterThan(0);
    expect(screen.getAllByText('68').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+2/).length).toBeGreaterThan(0);
    // «+2 сегодня» в значке и на компьютере: «68 Платят · сегодня» читалось как «сегодня заплатили 68» (C4-6)
    expect(screen.getAllByText('+2 сегодня')).toHaveLength(2); // компьютер и телефон
    expect(screen.queryByText(/Платят · сегодня/)).toBeNull();
    // старые «58 / 81» (с Team) и «+5 списаний» — не показываются
    expect(screen.queryByText('58')).toBeNull();
    expect(screen.queryByText('81')).toBeNull();
    expect(screen.queryByText(/\+5/)).toBeNull();
  });

  it('shows a dash, not zero or the old numbers, when the new fields are missing', async () => {
    await renderPanel({});

    expect((await screen.findAllByText('Платят')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('81')).toBeNull();
  });
});
