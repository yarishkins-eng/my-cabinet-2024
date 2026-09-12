// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import AdminUsers from './AdminUsers';

const { getStats, getUsers } = vi.hoisted(() => ({
  getStats: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock('../api/adminUsers', () => ({
  adminUsersApi: { getStats, getUsers },
}));

vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => String(value) }),
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type UsersLocale = {
  admin: {
    users: {
      stats: Record<string, string>;
    };
  };
};

function locale(language: string): UsersLocale {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'locales', `${language}.json`), 'utf8'),
  ) as UsersLocale;
}

const stats = {
  total_users: 101,
  active_users: 202,
  blocked_users: 707,
  deleted_users: 0,
  new_today: 606,
  new_week: 0,
  new_month: 0,
  users_with_subscription: 0,
  users_with_active_subscription: 404,
  users_with_trial: 0,
  users_with_expired_subscription: 0,
  users_on_trial: 303,
  users_paying: 505,
  total_balance_kopeks: 0,
  total_balance_rubles: 0,
  avg_balance_kopeks: 0,
  active_today: 0,
  active_week: 0,
  active_month: 0,
};

async function renderPage(payload: Record<string, number>) {
  getUsers.mockResolvedValue({ users: [], total: 0 });
  getStats.mockResolvedValue(payload);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminUsers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('admin.users.stats.onTrial');
}

function card(label: string): HTMLElement {
  const element = screen.getByText(label).parentElement;
  if (!element) throw new Error(`Statistic card not found: ${label}`);
  return element;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminUsers truthful statistic cards', () => {
  it('binds each explanatory label to the intended API value', async () => {
    await renderPage(stats);

    expect(card('admin.users.stats.onTrial').textContent).toContain('303');
    expect(card('admin.users.stats.onTrial').textContent).toContain(
      'admin.users.stats.onTrialHint',
    );
    expect(card('admin.users.stats.paying').textContent).toContain('505');
    expect(card('admin.users.stats.paying').textContent).toContain('admin.users.stats.payingHint');
    expect(card('admin.users.stats.newToday').textContent).toContain('606');
    expect(card('admin.users.stats.newToday').textContent).toContain(
      'admin.users.stats.newTodayHint',
    );
    expect(screen.queryByText('202')).toBeNull();
    expect(screen.queryByText('404')).toBeNull();
  });

  it('shows zero for both new cards while the older API response is being replaced', async () => {
    const oldPayload = { ...stats };
    delete (oldPayload as Partial<typeof stats>).users_on_trial;
    delete (oldPayload as Partial<typeof stats>).users_paying;

    await renderPage(oldPayload);

    expect(card('admin.users.stats.onTrial').textContent).toContain('0');
    expect(card('admin.users.stats.paying').textContent).toContain('0');
  });

  it('provides the five new labels and removes the dead labels in every language', () => {
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const localeStats = locale(language).admin.users.stats;
      for (const key of ['onTrial', 'onTrialHint', 'paying', 'payingHint', 'newTodayHint']) {
        expect(localeStats[key]).toBeTruthy();
      }
      expect(localeStats.active).toBeUndefined();
      expect(localeStats.withSubscription).toBeUndefined();
    }
  });
});
