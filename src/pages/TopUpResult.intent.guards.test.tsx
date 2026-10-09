// @vitest-environment jsdom
// 🔴 ВК-16 (16в-2), волна 2: сторожа мутационного скептика — каждый закрывает мутацию, пережившую основной набор
// на `8a58f513` (метка P-<номер мутации>; таблица — записка 16в, раздел «После волны 2»). Зелёные на исправленном коде,
// красные на своей мутации.

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
const openLink = vi.fn();
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (s: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser }),
}));

vi.mock('@/platform', () => ({
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn() }),
  usePlatform: () => ({ openLink }),
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

const sleep = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const polls = () => vi.mocked(balanceApi.getPendingPayment).mock.calls.length;

describe('PROBE-R', () => {
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

  it('P-R04 отказ «к заказу» — опрос идёт дальше и подхватывает «оформлено»', async () => {
    vi.mocked(balanceApi.getPendingPayment)
      .mockResolvedValueOnce(
        intentPayment({
          is_paid: true,
          intent_outcome: 'refused',
          intent_paid: true,
          intent_reason: 'open_order',
          intent_refusal_kind: 'order',
        }),
      )
      .mockResolvedValue(
        intentPayment({
          is_paid: true,
          intent_outcome: 'fulfilled',
          intent_paid: true,
          intent_checkout_public_id: 'CO-9',
        }),
      );
    renderResult('?method=platega');
    expect(await screen.findByText('balance.topUpResult.intent.notPlacedTitle')).toBeTruthy();
    expect(
      await screen.findByText('balance.topUpResult.intent.readyTitle', {}, { timeout: 5000 }),
    ).toBeTruthy();
  }, 15000);

  it('P-R05 отказ «в поддержку» — опрос остановлен', async () => {
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
    await sleep(3600);
    expect(polls()).toBe(1);
  }, 15000);

  it('P-R09 закрыт без денег и провайдер закрыл — опрос остановлен', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        intent_outcome: 'closed',
        intent_reason: 'cancelled',
        intent_paid: false,
        status: 'expired',
      }),
    );
    renderResult('?method=platega');
    await screen.findByText('balance.topUpResult.intent.closedTitle');
    await sleep(3600);
    expect(polls()).toBe(1);
  }, 15000);

  it('P-R10 waiting + счёт сгорел — отказ и опрос остановлен', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment({ status: 'expired' }));
    renderResult('?method=platega');
    await screen.findByText('balance.topUpResult.failed');
    await sleep(3600);
    expect(polls()).toBe(1);
  }, 15000);

  it('P-R11 waiting — опрос идёт и подхватывает «оформляем»', async () => {
    vi.mocked(balanceApi.getPendingPayment)
      .mockResolvedValueOnce(intentPayment())
      .mockResolvedValue(
        intentPayment({ is_paid: true, intent_outcome: 'processing', intent_paid: true }),
      );
    renderResult('?method=platega');
    expect(await screen.findByText('balance.topUpResult.intent.waitingTitle')).toBeTruthy();
    expect(
      await screen.findByText('balance.topUpResult.intent.processingTitle', {}, { timeout: 5000 }),
    ).toBeTruthy();
  }, 15000);

  it('P-R24 возврат с «не прошло» после ответа сервера «ждём» — отказ остаётся', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment());
    renderResult('?method=platega&status=failed');
    await waitFor(() => expect(polls()).toBeGreaterThan(0));
    await sleep(50);
    expect(screen.getByText('balance.topUpResult.failed')).toBeTruthy();
    expect(screen.queryByText('balance.topUpResult.intent.waitingTitle')).toBeNull();
  });

  it('P-R26 waiting 10 минут — «слишком долго», а не вечное ожидание', async () => {
    vi.useFakeTimers();
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment());
    renderResult('?method=platega');
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('balance.topUpResult.timeout')).toBeTruthy();
  });

  it('P-R27 waiting, но деньги пришли — «processing», без «проверить»', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment({ is_paid: true }));
    renderResult('?method=platega');
    expect(await screen.findByText('balance.topUpResult.intent.processingTitle')).toBeTruthy();
    expect(screen.queryByText('balance.topUpResult.intent.checkAgain')).toBeNull();
  });

  it('P-R33 «не хватило» — без «деньги на балансе»', async () => {
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
    await screen.findByText('balance.topUpResult.intent.notPlacedTitle');
    expect(screen.queryByText('balance.topUpResult.intent.moneyOnBalance')).toBeNull();
  });

  it('P-R34 обычный отказ — «деньги на балансе» написано', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'price_changed',
        intent_refusal_kind: 'retry',
      }),
    );
    renderResult('?method=platega');
    await screen.findByText('balance.topUpResult.intent.notPlacedTitle');
    expect(screen.getByText('balance.topUpResult.intent.moneyOnBalance')).toBeTruthy();
  });

  it('P-R38 деньги по намерению — баланс в шапке перечитан', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: false,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_payment_id: 4100,
        intent_reason: 'replaced',
        intent_refusal_kind: 'retry',
      }),
    );
    const { queryClient } = renderResult('?method=platega');
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByText('balance.topUpResult.intent.notPlacedTitle');
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['balance'] }));
  });

  it('P-R42 оформлено без номера заказа — на Главную', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'fulfilled',
        intent_paid: true,
        intent_checkout_public_id: null,
      }),
    );
    renderResult('?method=platega');
    await waitFor(() => expect(location()).toBe('/'), { timeout: 4000 });
  });

  it('P-R48 нет intent_amount_kopeks — сумма записи', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({ intent_amount_kopeks: null }),
    );
    renderResult('?method=platega');
    await screen.findByText('balance.topUpResult.intent.waitingTitle');
    expect(document.body.textContent).toContain('60.00');
  });

  it('P-R50 «к заказу» без номера — к покупке', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: true,
        intent_outcome: 'refused',
        intent_paid: true,
        intent_reason: 'open_order',
        intent_refusal_kind: 'order',
        intent_checkout_public_id: null,
      }),
    );
    renderResult('?method=platega');
    fireEvent.click(await screen.findByText('balance.topUpResult.intent.toMyOrder'));
    expect(location()).toBe('/subscription/purchase');
  });

  it('P-R59 оформлено без пометки «деньги» — кэш кассы снесён', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(
      intentPayment({
        is_paid: false,
        intent_outcome: 'fulfilled',
        intent_paid: false,
        intent_checkout_public_id: 'CO-1',
      }),
    );
    const { queryClient } = renderResult('?method=platega');
    queryClient.setQueryData(['device-first-options'], { balance_kopeks: 0 });
    await screen.findByText('balance.topUpResult.intent.readyTitle');
    await waitFor(() => expect(queryClient.getQueryData(['device-first-options'])).toBeUndefined());
  });

  it('16в-3 PD: продолжить свой действующий счёт без создания нового', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment());
    renderResult('?method=platega');
    fireEvent.click(
      await screen.findByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
    );
    expect(openLink).toHaveBeenCalledWith('https://pay.example/4242');
    expect(location()).toBe('/balance/top-up/result?method=platega');
  });

  for (const [name, overrides] of Object.entries({
    predecessor: { intent_payment_id: 4241 },
    paid: { intent_paid: true },
    paidRecord: { is_paid: true },
    closed: { intent_outcome: 'closed' },
    processing: { intent_outcome: 'processing' },
    failed: { status: 'failed' },
    unknown: { status: 'unexpected' },
    expired: { expires_at: '2000-01-01T00:00:00Z' },
    paidStatus: { status: 'paid' },
    missingUrl: { payment_url: null },
  } satisfies Record<string, Partial<PendingPayment>>)) {
    it(`16в-3 PD: нет ссылки для ${name}`, async () => {
      vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(intentPayment(overrides));
      renderResult('?method=platega');
      await waitFor(() => expect(polls()).toBeGreaterThan(0));
      await sleep(50);
      expect(
        screen.queryByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
      ).toBeNull();
      expect(openLink).not.toHaveBeenCalled();
    });
  }

  it('16в-3 PD: cached waiting после ошибки не разрешает ссылку', async () => {
    vi.mocked(balanceApi.getPendingPayment).mockRejectedValue(new Error('offline'));
    const { queryClient } = renderResult('?method=platega');
    queryClient.setQueryData(['topup-status', 'platega', 4242], intentPayment());
    await sleep(100);
    expect(
      screen.queryByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
    ).toBeNull();
  });

  for (const source of ['id', 'latest']) {
    it(`16в-3 PD: 9 минут до оплаты не сокращают 10 минут оформления (${source})`, async () => {
      vi.useFakeTimers();
      if (source === 'latest') localStorage.clear();
      const api = vi.mocked(
        source === 'id' ? balanceApi.getPendingPayment : balanceApi.getLatestPayment,
      );
      api.mockResolvedValue(intentPayment());
      renderResult('?method=platega');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      });
      api.mockResolvedValue(
        intentPayment({ intent_outcome: 'processing', intent_paid: true, is_paid: true }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      });
      expect(screen.getByText('balance.topUpResult.intent.processingTitle')).toBeTruthy();
      expect(screen.queryByText('balance.topUpResult.intent.delayedTitle')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
      });
      expect(screen.getByText('balance.topUpResult.intent.delayedTitle')).toBeTruthy();
    });
  }
});
