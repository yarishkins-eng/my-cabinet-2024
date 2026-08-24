// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
