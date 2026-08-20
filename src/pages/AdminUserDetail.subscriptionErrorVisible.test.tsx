// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PlatformProvider } from '../platform';

/**
 * 🔴 Пункт 2.2б. Форма выдачи подписки глотала ЛЮБОЙ отказ сервера: `catch` писал
 * только в консоль. Владелец видел, как спиннер погас, и не мог отличить успех от
 * отказа — именно эта немота позволила «подписке без серверов» прожить незамеченной.
 *
 * Сторожим не наличие строки в файле, а поведение через настоящую точку входа:
 * сервер отвечает отказом → причина отказа доходит до человека.
 */

const { getUser, updateSubscription, notifyError, notifySuccess } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateSubscription: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('../api/adminUsers', () => ({
  adminUsersApi: {
    getUser,
    updateSubscription,
    // Имена сверены со списком в src/api/adminUsers.ts: подставное имя даёт
    // undefined и роняет страницу задолго до проверяемого нажатия.
    getAvailableTariffs: vi.fn().mockResolvedValue({ tariffs: [] }),
    getSyncStatus: vi.fn().mockResolvedValue(null),
    getPanelInfo: vi.fn().mockResolvedValue(null),
    getNodeUsage: vi.fn().mockResolvedValue({ items: [] }),
    getUserDevices: vi.fn().mockResolvedValue({ devices: [], total: 0, device_limit: 0 }),
    getUserGifts: vi.fn().mockResolvedValue({ gifts: [] }),
    getReferrals: vi.fn().mockResolvedValue([]),
    getSubscriptionRequestHistory: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));

vi.mock('../api/promocodes', () => ({
  promocodesApi: { getPromoGroups: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../platform/hooks/useNotify', () => ({
  useNotify: () => ({ error: notifyError, success: notifySuccess, info: vi.fn() }),
}));

vi.mock('../store/permissions', () => ({
  usePermissionStore: (selector: (s: unknown) => unknown) =>
    selector({ hasPermission: () => true }),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'ru', changeLanguage: vi.fn() },
    }),
  };
});

const USER = {
  id: 78,
  telegram_id: 1,
  username: 'vadim',
  first_name: 'Vadim',
  last_name: null,
  full_name: 'Vadim',
  status: 'active',
  language: 'ru',
  balance_kopeks: 0,
  balance_rubles: 0,
  email: null,
  email_verified: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  last_activity: null,
  cabinet_last_login: null,
  subscription: null,
  subscriptions: [
    {
      id: 62,
      tariff_id: 3,
      tariff_name: 'Базовый',
      status: 'active',
      is_active: true,
      is_trial: false,
      traffic_used_gb: 0,
      traffic_limit_gb: 100,
      device_limit: 1,
      days_remaining: 10,
      end_date: '2026-09-01T00:00:00Z',
    },
  ],
  promo_group: null,
  referral: {
    referrals_count: 0,
    total_earned_kopeks: 0,
    invited_by: null,
    commission_percent: null,
  },
  total_spent_kopeks: 0,
  purchase_count: 0,
  used_promocodes: 0,
  has_had_paid_subscription: false,
  lifetime_used_traffic_bytes: 0,
  campaign_name: null,
  campaign_id: null,
  restriction_topup: false,
  restriction_subscription: false,
  restriction_reason: null,
  promo_offer_discount_percent: 0,
  promo_offer_discount_source: null,
  promo_offer_discount_expires_at: null,
  recent_transactions: [],
  remnawave_uuid: null,
  account_erasure_state: null,
  account_erasure_resolution_code: null,
  account_erasure_requested_at: null,
} as unknown as Awaited<ReturnType<typeof getUser>>;

async function renderPage() {
  const { default: AdminUserDetail } = await import('./AdminUserDetail');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlatformProvider>
        <MemoryRouter initialEntries={['/admin/users/78']}>
          <Routes>
            <Route path="/admin/users/:id" element={<AdminUserDetail />} />
          </Routes>
        </MemoryRouter>
      </PlatformProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('admin.users.detail.tabs.subscription');
  fireEvent.click(screen.getByText('admin.users.detail.tabs.subscription'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Отказ сервера на форме подписки доходит до владельца (пункт 2.2б)', () => {
  it('причина из ответа сервера показывается, а не тонет в консоли', async () => {
    getUser.mockResolvedValue(USER);
    updateSubscription.mockRejectedValue({
      response: { data: { detail: 'tariff_id parameter is required' } },
    });

    await renderPage();

    const applyButton = await screen.findByText('admin.users.actions.apply');
    fireEvent.click(applyButton);

    await waitFor(() => expect(updateSubscription).toHaveBeenCalled());
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('tariff_id parameter is required', 'common.error'),
    );
  });

  it('отказ без текста причины всё равно виден человеком', async () => {
    getUser.mockResolvedValue(USER);
    updateSubscription.mockRejectedValue(new Error('Network Error'));

    await renderPage();

    const applyButton = await screen.findByText('admin.users.actions.apply');
    fireEvent.click(applyButton);

    await waitFor(() => expect(updateSubscription).toHaveBeenCalled());
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('admin.users.userActions.error', 'common.error'),
    );
  });
});
