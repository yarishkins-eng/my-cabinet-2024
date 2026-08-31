// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import Balance from './Balance';

// 🔴 Этап В-1. Экран результата после этапа объявляет «оплачено» только со слов СЕРВЕРА — но
// спросить сервер он может лишь зная, о чём спрашивать. Этот экран уводил на результат БЕЗ
// способа оплаты, и там центральная гарантия этапа молча вырождалась в доверие адресной
// строке. Сторожа не было: мутация, убирающая передачу способа, переживала весь набор.

vi.mock('../api/balance', () => ({
  balanceApi: {
    getBalance: vi.fn().mockResolvedValue({ balance_kopeks: 0, balance_rubles: 0 }),
    getTransactions: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 }),
    getPaymentMethods: vi.fn().mockResolvedValue([]),
    getSavedCards: vi.fn().mockResolvedValue({ cards: [] }),
    activatePromocode: vi.fn(),
    deleteSavedCard: vi.fn(),
  },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (s: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser: vi.fn() }),
}));

vi.mock('@/platform', () => ({
  usePlatform: () => 'telegram',
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn() }),
  useOpenLink: () => vi.fn(),
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
  openInvoice: vi.fn(),
}));

vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (v: number) => String(v), currencySymbol: '₽' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderBalance(search: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/balance' + search]}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        <Routes>
          <Route path="/balance" element={<Balance />} />
          <Route path="*" element={<output data-testid="elsewhere" />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Balance — возврат от платёжной системы', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('уводя на экран результата, несёт СПОСОБ оплаты', async () => {
    renderBalance('?status=success&method=platega');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?status=success&method=platega',
      ),
    );
  });

  it('несёт способ и на отказе', async () => {
    renderBalance('?payment=failed&method=platega');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?status=failed&method=platega',
      ),
    );
  });

  // 🔴 Второй конец шкалы: способа в адресе нет — и выдумывать его нельзя, иначе экран
  // результата пойдёт спрашивать сервер не о том платеже.
  it('без способа в адресе ничего не выдумывает', async () => {
    renderBalance('?status=success');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?status=success',
      ),
    );
  });
});

describe('Balance — история операций читается человеком (этап ДВ-3)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  // 🔴 До этой ветки значок печатал СЫРОЙ тип: человек читал в своей истории слово
  // `provider_receipt`. Проверено на боевом — такие записи есть у 19 человек, и это половина
  // проводки за подписку, купленную картой. Стережём свойство: на экране не должно быть
  // машинного имени типа, а подпись обязана прийти из локали.
  it('приход от банка подписан по-человечески, а не сырым типом', async () => {
    const { balanceApi } = await import('../api/balance');
    vi.mocked(balanceApi.getTransactions).mockResolvedValue({
      items: [
        {
          id: 1,
          type: 'provider_receipt',
          amount_kopeks: 119900,
          amount_rubles: 1199,
          description: 'Платёж картой получен: подписка на 6 месяцев, лимит устройств 2',
          payment_method: 'platega',
          is_completed: true,
          created_at: new Date(0).toISOString(),
          completed_at: null,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    } as never);

    renderBalance('');

    // 🔴 История операций в кабинете СВЁРНУТА по умолчанию — её надо раскрыть. Сторож,
    // написанный без этого клика, не находил бы вообще ничего и легко сошёл бы за
    // «текста нет, значит всё хорошо».
    fireEvent.click(await screen.findByText('balance.transactionHistory'));

    await screen.findByText('balance.providerReceipt');
    expect(screen.queryByText('provider_receipt')).toBeNull();
    expect(
      screen.getByText('Платёж картой получен: подписка на 6 месяцев, лимит устройств 2'),
    ).toBeTruthy();
  });
});
