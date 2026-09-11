// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { searchPayments, getSearchStats, closeDeviceAddonAttempt, confirmDialog } = vi.hoisted(
  () => ({
    searchPayments: vi.fn(),
    getSearchStats: vi.fn(),
    closeDeviceAddonAttempt: vi.fn(),
    confirmDialog: vi.fn(),
  }),
);

vi.mock('../api/adminPayments', () => ({
  adminPaymentsApi: {
    searchPayments,
    getSearchStats,
    closeDeviceAddonAttempt,
    checkPaymentStatus: vi.fn(),
  },
}));

vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => String(value), currencySymbol: '₽' }),
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));

vi.mock('../platform/hooks/useNativeDialog', () => ({
  useNativeDialog: () => ({ confirm: confirmDialog }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import AdminPayments from './AdminPayments';

const addonPayment = {
  id: 41,
  method: 'platega',
  method_display: 'Platega',
  identifier: 'local-correlation',
  amount_kopeks: 10_000,
  amount_rubles: 100,
  status: 'OPERATOR_REVIEW',
  status_emoji: '⚠️',
  status_text: 'Требуется проверка',
  is_paid: false,
  is_checkable: false,
  created_at: '2026-09-11T08:00:00Z',
  expires_at: null,
  payment_url: null,
  is_device_addon: true,
  device_addon_reason: 'provider_identity_unknown_no_retry',
  device_addon_reason_text: 'Провайдер не вернул ID счёта; нужно решение оператора.',
  can_close_device_addon_attempt: true,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminPayments />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminPayments device add-on recovery', () => {
  beforeEach(() => {
    searchPayments.mockReset();
    getSearchStats.mockReset();
    closeDeviceAddonAttempt.mockReset();
    confirmDialog.mockReset();
    searchPayments.mockResolvedValue({
      items: [addonPayment],
      total: 1,
      page: 1,
      per_page: 20,
      pages: 1,
    });
    getSearchStats.mockResolvedValue({
      total: 1,
      pending: 1,
      paid: 0,
      cancelled: 0,
      by_method: {},
    });
    confirmDialog.mockResolvedValue(true);
    closeDeviceAddonAttempt.mockResolvedValue({
      success: true,
      message: 'Попытка закрыта без зачисления.',
      payment: { ...addonPayment, can_close_device_addon_attempt: false },
      status_changed: true,
      old_status: 'operator_review',
      new_status: 'terminal',
    });
  });

  afterEach(cleanup);

  it('shows the marker and reason, then closes only after native confirmation', async () => {
    renderPage();

    expect(await screen.findByText('admin.payments.deviceAddon')).toBeTruthy();
    expect(screen.getByText(addonPayment.device_addon_reason_text)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'admin.payments.closeAttempt' }));

    await waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith('admin.payments.closeAttemptConfirm'),
    );
    await waitFor(() => expect(closeDeviceAddonAttempt).toHaveBeenCalledWith('platega', 41));
  });

  it('does not close when the operator cancels the confirmation', async () => {
    confirmDialog.mockResolvedValue(false);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'admin.payments.closeAttempt' }));

    await waitFor(() =>
      expect(confirmDialog).toHaveBeenCalledWith('admin.payments.closeAttemptConfirm'),
    );
    expect(closeDeviceAddonAttempt).not.toHaveBeenCalled();
  });

  it('does not offer closing when the backend marks the attempt as ineligible', async () => {
    searchPayments.mockResolvedValue({
      items: [{ ...addonPayment, can_close_device_addon_attempt: false }],
      total: 1,
      page: 1,
      per_page: 20,
      pages: 1,
    });
    renderPage();

    expect(await screen.findByText('admin.payments.deviceAddon')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'admin.payments.closeAttempt' })).toBeNull();
  });

  it('shows the structured backend reason when closing is rejected', async () => {
    closeDeviceAddonAttempt.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          detail: {
            code: 'attempt_cannot_be_closed',
            message: 'Счёт уже получил ID провайдера; закройте его после проверки.',
          },
        },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'admin.payments.closeAttempt' }));

    expect(
      await screen.findByText('Счёт уже получил ID провайдера; закройте его после проверки.'),
    ).toBeTruthy();
  });
});
