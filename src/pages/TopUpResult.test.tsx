// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpResult from './TopUpResult';

// 🔴 Этап Б-1. До этого файла у экрана результата пополнения НЕ БЫЛО НИ ОДНОГО ТЕСТА, и весь
// пункт 2 этапа (возврат человека на кассу) не был прикрыт ничем: мутационный прогон показал,
// что откат любого из трёх поведений — «Готово» на кассу, «Назад» на кассу, гашение кэша кассы —
// проходит весь набор из 265 тестов чисто. Зелёный набор про этот экран не говорил ничего.

vi.mock('../api/balance', () => ({
  balanceApi: {
    getPendingPayment: vi.fn(),
    getLatestPayment: vi.fn(),
  },
}));

const refreshUser = vi.fn();
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (s: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser }),
}));

vi.mock('@/platform', () => ({
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn() }),
}));

vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? key : key),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => {
          const Tag = tag as 'div';
          const safe = Object.fromEntries(
            Object.entries(rest).filter(
              ([k]) => !['initial', 'animate', 'exit', 'transition'].includes(k),
            ),
          );
          return <Tag {...safe}>{children}</Tag>;
        },
    },
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// Адрес, который кладёт касса. Зашит ЛИТЕРАЛОМ намеренно: сторож, собирающий адрес тем же
// выражением, что и проверяемый код, доказывает только сам себя.
const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=90&devices=5';

function renderResult(search: string, seed?: (client: QueryClient) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Кэш заполняется ДО рендера: гашение стоит в эффекте, который отрабатывает один раз при
  // монтировании, поэтому запись после render() он бы уже не застал.
  seed?.(queryClient);
  const utils = render(
    <MemoryRouter initialEntries={['/balance/top-up/result' + search]}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        <Routes>
          <Route path="/balance/top-up/result" element={<TopUpResult />} />
          <Route path="*" element={<output data-testid="elsewhere" />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, queryClient };
}

describe('TopUpResult — возврат на кассу после пополнения (этап Б-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it('после успешной доплаты возвращает человека НА КАССУ, а не на Главную', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Подпись обещает то, что произойдёт. «Перейти к подписке» для кассы — ложь ровно в ту
  // секунду, когда деньги уже взяты: подписки ещё нет, пополнение ничего не оформило.
  it('на кассу зовёт кнопкой оформления, а не обещанием подписки', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    expect((await screen.findByRole('button')).textContent).toBe('deviceFirst.review');
  });

  // 🔴 Граница исключения. Соседние экраны (продление, докупка, смена тарифа) кладут в returnTo
  // адрес БЕЗ метки кассы, и у них корзина на сервере исполняется сама — их обязано уводить
  // на Главную, как и до этапа.
  it('НЕ трогает соседние экраны: без метки кассы уводит на Главную, как раньше', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent('/subscription/purchase'));

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  it('обычное пополнение без адреса возврата уводит на баланс', async () => {
    renderResult('?status=success');

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/balance'));
  });

  // 🔴 Касса берёт баланс СВОИМ запросом. Без гашения этого кэша вернувшийся видит первым кадром
  // старый баланс и прежнее «не хватает» — ровно то, ради чего уходил платить.
  it('гасит кэш кассы, иначе вернувшийся увидит старый баланс', async () => {
    const { queryClient } = renderResult(
      '?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN),
      (client) => client.setQueryData(['device-first-options'], { balance_kopeks: 0 }),
    );

    await waitFor(() =>
      expect(queryClient.getQueryState(['device-first-options'])?.isInvalidated).toBe(true),
    );
  });
});
