// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BalanceTab, type BalanceTabProps } from './BalanceTab';

/**
 * 🔴 Этап УБ-1. Экран менял баланс и не говорил админу НИЧЕГО: при успехе не было
 * тоста вовсе, при отказе сервера — только `console.error`. Соседние кнопки на этом
 * же экране тосты показывают.
 *
 * Теперь сообщение клиенту уходит из бота, и экран обязан честно назвать ИСХОД
 * ДОСТАВКИ: дошло, не дошло, или бот старый и поля не прислал. Сторожим именно
 * исход, а не подпись: тексты проверяет отдельный сторож по словарям — здесь
 * `react-i18next` замокан, и настоящие локали не читаются (урок РЕК-8).
 */

const notifySuccess = vi.fn();
const notifyWarning = vi.fn();
const notifyError = vi.fn();
const updateBalance = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'ru', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('../../../platform/hooks/useNotify', () => ({
  useNotify: () => ({
    success: notifySuccess,
    warning: notifyWarning,
    error: notifyError,
    info: vi.fn(),
    notify: vi.fn(),
  }),
}));

vi.mock('../../../api/adminUsers', () => ({
  adminUsersApi: {
    updateBalance: (...args: unknown[]) => updateBalance(...args),
  },
}));

vi.mock('../../../api/promocodes', () => ({
  promocodesApi: { deactivateDiscount: vi.fn() },
}));

vi.mock('../../../api/promoOffers', () => ({
  promoOffersApi: { broadcastOffer: vi.fn() },
}));

const USER = {
  balance_rubles: 500,
  balance_kopeks: 50000,
  promo_offer_discount_percent: 0,
  recent_transactions: [],
} as unknown as BalanceTabProps['user'];

function renderTab() {
  // Вкладка читает курс валют через react-query — без провайдера она не смонтируется.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BalanceTab
        user={USER}
        userId={185}
        hasPermission={() => true}
        onUserRefresh={vi.fn()}
        formatDate={() => '01.01.2026'}
      />
    </QueryClientProvider>,
  );
}

async function creditOneRouble() {
  const amount = screen.getByPlaceholderText('admin.users.detail.balance.amountPlaceholder');
  fireEvent.change(amount, { target: { value: '1' } });
  fireEvent.click(screen.getByText('admin.users.detail.balance.add'));
}

describe('исход доставки сообщения о деньгах', () => {
  beforeEach(() => {
    notifySuccess.mockClear();
    notifyWarning.mockClear();
    notifyError.mockClear();
    updateBalance.mockReset();
  });

  afterEach(cleanup);

  it('дошло — админ видит подтверждение, а не тишину', async () => {
    updateBalance.mockResolvedValue({
      success: true,
      old_balance_kopeks: 0,
      new_balance_kopeks: 100,
      message: 'ok',
      notified: true,
    });

    renderTab();
    await creditOneRouble();

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledTimes(1));
    expect(notifySuccess.mock.calls[0][0]).toBe('admin.users.detail.balance.delivered');
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it('не дошло — предупреждение, а не «успех»', async () => {
    updateBalance.mockResolvedValue({
      success: true,
      old_balance_kopeks: 0,
      new_balance_kopeks: 100,
      message: 'ok',
      notified: false,
    });

    renderTab();
    await creditOneRouble();

    await waitFor(() => expect(notifyWarning).toHaveBeenCalledTimes(1));
    expect(notifyWarning.mock.calls[0][0]).toBe('admin.users.detail.balance.notDelivered');
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('поле не пришло (старый бот) — не утверждаем ни «дошло», ни «не дошло»', async () => {
    updateBalance.mockResolvedValue({
      success: true,
      old_balance_kopeks: 0,
      new_balance_kopeks: 100,
      message: 'ok',
    });

    renderTab();
    await creditOneRouble();

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledTimes(1));
    expect(notifySuccess.mock.calls[0][0]).toBe('admin.users.detail.balance.saved');
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it('сервер отказал — админ узнаёт об этом; раньше отказ уходил только в консоль', async () => {
    updateBalance.mockRejectedValue(new Error('500'));

    renderTab();
    await creditOneRouble();

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(notifyWarning).not.toHaveBeenCalled();
  });
});
