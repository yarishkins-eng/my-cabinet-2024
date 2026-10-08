// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpResult from './TopUpResult';
import { balanceApi } from '../api/balance';
import type { PendingPayment } from '../types';

// 🔴 ВК-16 (16в-2). Экран ожидания доплаты под заказ ждёт ЗАКАЗ, а не деньги (замысел v2, правило 1).
// До этой части экран по `is_paid` через 1,8 с уводил на кассу — поверх подписки, которую сервер уже оформил
// (Т1). Каждый сторож здесь краснеет на коде до 16в-2.

vi.mock('../api/balance', () => ({
  balanceApi: {
    getPendingPayment: vi.fn(),
    getLatestPayment: vi.fn(),
    checkPaymentStatus: vi.fn(),
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

// Ключ и подстановки печатаются целиком: сторож видит и КАКОЙ текст, и С ЧЕМ он собран.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === 'object' && Object.keys(options).length > 0
        ? `${key}|${JSON.stringify(options)}`
        : key,
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

// Адрес кассы зашит литералом; срок и устройства в нём НАМЕРЕННО другие, чем у заказа намерения (30 / 2):
// кнопка «Оформить» обязана взять срок заказа, а не адрес возврата.
const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=90&devices=5';

function seedPendingInfo() {
  localStorage.setItem(
    'topup_pending_payment',
    JSON.stringify({
      amount_kopeks: 5000,
      method_id: 'platega',
      method_name: 'Platega',
      payment_id: '4242',
      created_at: Date.now(),
      return_to: CHECKOUT_RETURN,
    }),
  );
}

function intentPayment(overrides: Partial<PendingPayment> = {}): PendingPayment {
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
    payment_url: 'https://pay.example/4242',
    intent_outcome: 'waiting',
    intent_payment_id: 4242,
    intent_paid: false,
    intent_amount_kopeks: 6000,
    intent_period_days: 30,
    intent_devices: 2,
    intent_quote_kopeks: 19900,
    ...overrides,
  };
}

function renderResult(search: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
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

const location = () => screen.getByTestId('location').textContent;

describe('TopUpResult — доплата под заказ ждёт заказ, а не деньги (ВК-16 · 16в-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    seedPendingInfo();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('пока банк не подтвердил — говорит, что подписка оформится сама', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment());
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.waitingTitle')).toBeTruthy();
    expect(screen.getByText('balance.topUpResult.intent.waitingDesc')).toBeTruthy();
  });

  // 🔴 Т1: деньги пришли раньше оформления. Старый экран через 1,8 с уводил на кассу «Списать… и оформить».
  it('деньги пришли, заказ ещё оформляется — НЕ уезжает на кассу', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        status: 'succeeded',
        intent_outcome: 'processing',
        intent_paid: true,
      }),
    );
    renderResult('?method=platega&status=success');

    expect(await screen.findByText('balance.topUpResult.intent.processingTitle')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expect(location()).toBe('/balance/top-up/result?method=platega&status=success');
    expect(screen.queryByText('balance.topUpResult.success')).toBeNull();
  });

  it('заказ оформлен — открывает его по номеру, а не кассу', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        status: 'succeeded',
        intent_outcome: 'fulfilled',
        intent_paid: true,
        intent_checkout_public_id: 'CO-77',
      }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.readyTitle')).toBeTruthy();
    await waitFor(() => expect(location()).toBe('/subscription/purchase?checkout=CO-77'), {
      timeout: 4000,
    });
    expect(refreshUser).toHaveBeenCalled();
  });

  // 🔴 Мина PA не рождается: «Оформить» НЕ списывает с баланса, а открывает кассу со сроком и устройствами ЗАКАЗА
  // (30 / 2), а не адреса возврата (90 / 5).
  it('отказ «retry» с предложением ведёт в кассу с этим заказом и ничего не списывает', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        status: 'succeeded',
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'price_changed',
        intent_refusal_kind: 'retry',
        intent_offer_kopeks: 24900,
        intent_offer_tariff_name: 'Базовый <&>',
      }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.notPlacedTitle')).toBeTruthy();
    expect(screen.getByText('balance.topUpResult.intent.reasons.price_changed')).toBeTruthy();
    const offer = screen.getByRole('button', { name: /balance\.topUpResult\.intent\.offer/ });
    expect(offer.textContent).toContain('Базовый <&>');
    expect(offer.textContent).toContain('249.00 ₽');
    fireEvent.click(offer);
    expect(location()).toBe('/subscription/purchase?from=checkout&period=30&devices=2');
    expect(balanceApi.checkPaymentStatus).not.toHaveBeenCalled();
  });

  it('отказ «retry» без предложения — выбор срока того же заказа', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'balance_short',
        intent_refusal_kind: 'retry',
      }),
    );
    renderResult('?method=platega');

    fireEvent.click(await screen.findByText('balance.topUpResult.intent.choosePeriod'));
    expect(location()).toBe('/subscription/purchase?from=checkout&period=30&devices=2');
  });

  it('«уже купили другим путём» — ни одной кнопки покупки', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'already_purchased',
        intent_refusal_kind: 'bought',
        intent_offer_kopeks: 24900,
      }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.boughtTitle')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['balance.topUpResult.goToHome']);
    fireEvent.click(buttons[0]);
    expect(location()).toBe('/');
  });

  it('отказ «есть открытый заказ» — к этому заказу', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'open_order',
        intent_refusal_kind: 'order',
        intent_checkout_public_id: 'CO-9',
      }),
    );
    renderResult('?method=platega');

    fireEvent.click(await screen.findByText('balance.topUpResult.intent.toMyOrder'));
    expect(location()).toBe('/subscription/purchase?checkout=CO-9');
  });

  it('отказ «на проверке» — в поддержку, без покупки', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'order_on_review',
        intent_refusal_kind: 'support',
      }),
    );
    renderResult('?method=platega');

    await screen.findByText('balance.topUpResult.intent.notPlacedTitle');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['balance.topUpResult.intent.writeSupport']);
    fireEvent.click(buttons[0]);
    expect(location()).toBe('/support');
  });

  it('незнакомая причина — техническая ошибка, а не сырой код', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'wallet_insufficient',
        intent_refusal_kind: 'retry',
      }),
    );
    renderResult('?method=platega');

    expect(
      await screen.findByText('balance.topUpResult.intent.reasons.technical_error'),
    ).toBeTruthy();
  });

  // 🔴 Оплачен СТАРЫЙ счёт (сменил способ, а заплатил по прежней ссылке): запись — новый неоплаченный счёт на
  // 6000, деньги пришли по старому на 9900. Сумма — старого, опрос не останавливается по статусу новой записи.
  it('исход старого счёта: сумма — его, а не нового', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        status: 'expired',
        intent_outcome: 'refused',
        intent_payment_id: 4100,
        intent_paid: true,
        intent_amount_kopeks: 9900,
        intent_reason: 'replaced',
        intent_refusal_kind: 'retry',
      }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.notPlacedTitle')).toBeTruthy();
    expect(screen.getByText('99.00')).toBeTruthy();
    expect(screen.queryByText('60.00')).toBeNull();
    expect(screen.queryByText('balance.topUpResult.failed')).toBeNull();
  });

  it('счёт закрыт до оплаты — «больше не действует», денег не брали', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({ intent_outcome: 'closed', intent_reason: 'replaced', intent_paid: false }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.intent.closedTitle')).toBeTruthy();
    expect(screen.getByText('balance.topUpResult.intent.closedNoMoney')).toBeTruthy();
    fireEvent.click(screen.getByText('balance.topUpResult.backToOrder'));
    expect(location()).toBe(CHECKOUT_RETURN);
  });

  // Мина OU: закрытое намерение с пришедшими деньгами — две минуты «оформляем», потом «деньги на балансе».
  it('закрыто, но деньги пришли — сначала «проверяем», через две минуты — «деньги на балансе»', async () => {
    vi.useFakeTimers();
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'closed',
        intent_reason: 'cancelled',
        intent_paid: true,
        intent_refusal_kind: 'retry',
      }),
    );
    renderResult('?method=platega');

    await vi.advanceTimersByTimeAsync(10);
    expect(screen.getByText('balance.topUpResult.intent.processingTitle')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(119 * 1000);
    expect(screen.queryByText('balance.topUpResult.intent.notPlacedTitle')).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * 1000);
    expect(screen.getByText('balance.topUpResult.intent.notPlacedTitle')).toBeTruthy();
    expect(screen.getByText('balance.topUpResult.intent.reasons.cancelled')).toBeTruthy();
  });

  // Мина OU: «оформляем» не вечно — потолок 10 минут, и тогда «деньги на балансе», а не спиннер.
  it('десять минут «оформляем» — деньги на балансе и дверь к заказу', async () => {
    vi.useFakeTimers();
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({ is_paid: true, intent_outcome: 'processing', intent_paid: true }),
    );
    renderResult('?method=platega');

    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('balance.topUpResult.intent.notPlacedTitle')).toBeTruthy();
    expect(screen.getByText('balance.topUpResult.intent.moneyOnBalance')).toBeTruthy();
    fireEvent.click(screen.getByText('balance.topUpResult.intent.choosePeriod'));
    expect(location()).toBe('/subscription/purchase?from=checkout&period=30&devices=2');
  });

  it('«Проверить ещё раз» спрашивает сервер о ЭТОМ платеже и переживает его отказ', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment());
    vi.mocked(balanceApi.checkPaymentStatus).mockRejectedValue(new Error('500'));
    renderResult('?method=platega');

    fireEvent.click(await screen.findByText('balance.topUpResult.intent.checkAgain'));
    await waitFor(() =>
      expect(balanceApi.checkPaymentStatus).toHaveBeenCalledWith('platega', 4242),
    );
    await waitFor(() =>
      expect(vi.mocked(balanceApi.getPendingPayment).mock.calls.length).toBeGreaterThan(1),
    );
    expect(screen.getByText('balance.topUpResult.intent.waitingTitle')).toBeTruthy();
  });

  it('счёт сгорел у провайдера без денег — прежний экран отказа с дорогой к заказу', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment({ status: 'expired' }));
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.failed')).toBeTruthy();
    fireEvent.click(screen.getByText('balance.topUpResult.backToOrder'));
    expect(location()).toBe(CHECKOUT_RETURN);
  });

  it('обычное пополнение (без намерения) — прежнее поведение, уезжает на кассу', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        status: 'succeeded',
        intent_outcome: null,
        intent_payment_id: null,
        intent_paid: null,
      }),
    );
    renderResult('?method=platega');

    expect(await screen.findByText('balance.topUpResult.success')).toBeTruthy();
    await waitFor(() => expect(location()).toBe(`${CHECKOUT_RETURN}&topup=6000`), {
      timeout: 4000,
    });
  });
});
