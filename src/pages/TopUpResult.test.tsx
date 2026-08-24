// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpResult from './TopUpResult';
import { balanceApi } from '../api/balance';
import type { PendingPayment } from '../types';

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

/**
 * Записать память о начатом пополнении так, как её кладёт экран суммы. Именно эта запись —
 * единственный источник адреса возврата после того, как Телеграм перезапустил мини-приложение.
 * Ключ и форма зашиты ЛИТЕРАЛАМИ: сторож, зовущий `saveTopUpPendingInfo`, проверял бы сам себя.
 */
function seedPendingInfo(returnTo: string | null) {
  localStorage.setItem(
    'topup_pending_payment',
    JSON.stringify({
      amount_kopeks: 6000,
      method_id: 'platega',
      method_name: 'Platega',
      payment_id: '4242',
      created_at: Date.now(),
      return_to: returnTo,
    }),
  );
}

/** Ответ платёжной системы «счёт ещё не оплачен» — экран обязан остаться в ожидании. */
function pendingPayment(): PendingPayment {
  return {
    id: 4242,
    method: 'platega',
    method_display: 'Platega',
    identifier: '4242',
    amount_kopeks: 6000,
    amount_rubles: 60,
    status: 'pending',
    status_emoji: '⏳',
    status_text: 'pending',
    is_paid: false,
    is_checkable: true,
    created_at: new Date(0).toISOString(),
    expires_at: null,
    payment_url: null,
  };
}

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
    // 🔴 Этап В-1: память о пополнении переехала в localStorage (обязана пережить перезапуск
    // мини-приложения). Без этой строки запись протекала бы между тестами.
    localStorage.clear();
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
  // 🔴 Этап В-1 переписал ожидание (мина EI): Б-1 брал ключ `deviceFirst.review`, но им же
  // подписана ГЛАВНАЯ кнопка самой кассы — человек нажимал «Перейти к оформлению» и видел ту
  // же надпись второй раз. Ключ кассы зашит здесь ЛИТЕРАЛОМ намеренно: сторож обязан краснеть,
  // если кто-то вернёт совпадение подписей, а не следить за переменной, которую тот же кто-то
  // и поменяет.
  it('на кассу зовёт СВОЕЙ подписью, а не той же, что у кнопки самой кассы', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const label = (await screen.findByRole('button')).textContent;
    expect(label).toBe('balance.topUpResult.backToOrder');
    expect(label).not.toBe('deviceFirst.review');
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

  // ─────────────────────────────────────────────────────────────────────────────
  // 🔴 Этап В-1. Возврат из банка кнопкой провайдера: мини-приложение запускается ЗАНОВО,
  // и адрес возврата в строке браузера отсутствует физически.
  // ─────────────────────────────────────────────────────────────────────────────

  it('после перезапуска берёт адрес возврата из памяти, когда его нет в строке', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    // Ровно та строка, которую соберёт кабинет по метке запуска `tup-platega-ok`:
    // способ и статус есть, адреса возврата нет.
    renderResult('?method=platega&status=success');

    const done = await screen.findByRole('button');
    expect(done.textContent).toBe('balance.topUpResult.backToOrder');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Забор памяти. Запись в localStorage человек может подменить руками, поэтому она проходит
  // ту же проверку, что и адрес из строки: чужой адрес не уводит с кассы никуда.
  it('подменённый адрес в памяти не уводит наружу', async () => {
    seedPendingInfo('https://evil.example/steal');
    renderResult('?method=platega&status=success');

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  // 🔴 Мина EB: у экрана отказа был ОДИН выход — на баланс. Тот, кто шёл доплатить за
  // конкретную покупку, оставался без дороги обратно к своему живому заказу.
  it('отказ оплаты даёт дверь назад к покупке, а не только на баланс', async () => {
    renderResult('?status=failed&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const back = await screen.findByText('balance.topUpResult.backToOrder');
    fireEvent.click(back);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Граница той же правки: без метки кассы дверь назад НЕ появляется. У соседних экранов
  // покупки корзина не сохраняется, и звать их обратно — обещать несбыточное.
  it('без метки кассы у отказа остаётся ровно одна кнопка — прежняя', async () => {
    renderResult('?status=failed&returnTo=' + encodeURIComponent('/subscription/purchase'));

    const buttons = await screen.findAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('balance.topUpResult.tryAgain');
  });

  // 🔴 Мина EH: десять минут спиннера без единой кнопки. Уйти отсюда безопасно — деньги
  // зачисляет уведомление платёжной системы, а не этот экран.
  it('в ожидании есть выход, и он ведёт туда, что написано на кнопке', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    const leave = await screen.findByRole('button');
    // 🔴 Мина EG: пока исход платежа неизвестен, уводим НЕ на кассу (она покажет несвежий
    // баланс), а на Главную — и подпись обязана говорить именно это.
    expect(leave.textContent).toBe('deviceFirst.home');
    fireEvent.click(leave);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  // 🔴 Уход с экрана ожидания НЕ означает, что платёж закончился: человек мог уже нажать
  // оплату в банке. Память о пополнении несёт единственный уцелевший адрес возврата на кассу —
  // сотрём её здесь, и возврат кнопкой платёжной системы приземлит человека «на баланс»,
  // то есть этап сломает сам себя.
  it('уход из ожидания НЕ стирает адрес возврата', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    fireEvent.click(await screen.findByRole('button'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    const kept = localStorage.getItem('topup_pending_payment');
    expect(kept).not.toBeNull();
    expect(JSON.parse(kept!).return_to).toBe(CHECKOUT_RETURN);
  });

  // 🔴 Второй конец той же шкалы. Проверка «подпись = На главную» одна прошла бы и при
  // зашитой намертво надписи: надо убедиться, что у обычного пополнения подпись ДРУГАЯ.
  it('у обычного пополнения выход из ожидания подписан балансом и ведёт на баланс', async () => {
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    const leave = await screen.findByRole('button');
    expect(leave.textContent).toBe('balance.topUpResult.goToBalance');
    fireEvent.click(leave);

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
