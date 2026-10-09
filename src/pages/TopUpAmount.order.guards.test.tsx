// @vitest-environment jsdom
// 🔴 ВК-16 (16в-1), волна 2: сторожа мутационного скептика — каждый закрывает мутацию, пережившую основной набор
// на `8a58f513` (метка P-<номер мутации>; таблица — записка 16в, раздел «После волны 2»). Зелёные на исправленном коде,
// красные на своей мутации.

import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpAmount from './TopUpAmount';
import { useSuccessNotification } from '../store/successNotification';
import { resetRateLimit, RATE_LIMIT_KEYS } from '../utils/rateLimit';

// 🔴 ВК-16 (16в-1). «Оплата заказа» проверяется через НАСТОЯЩУЮ точку входа — экран суммы по адресу, который кладут
// кнопка «Доплатить» бота и касса. Каждый сторож, кроме контрольных (помечены), краснеет на коде до 16в-1.

const { getPaymentMethods, createTopUp, getOptions } = vi.hoisted(() => ({
  getPaymentMethods: vi.fn(),
  createTopUp: vi.fn(),
  getOptions: vi.fn(),
}));
vi.mock('../api/balance', () => ({
  balanceApi: { getPaymentMethods, createTopUp, createStarsInvoice: vi.fn() },
}));
vi.mock('../api/deviceFirst', () => ({ deviceFirstApi: { getOptions } }));

const { openLink, openTelegramLink } = vi.hoisted(() => ({
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
}));
vi.mock('@/platform', () => ({
  usePlatform: () => ({
    openLink,
    openTelegramLink,
    openInvoice: vi.fn(),
    platform: 'telegram',
    haptic: { impact: vi.fn(), notification: vi.fn(), selection: vi.fn() },
  }),
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn(), selection: vi.fn() }),
}));
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => String(value),
    currencySymbol: '₽',
    convertAmount: (rubles: number) => rubles,
    convertToRub: (units: number) => units,
    targetCurrency: 'RUB',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ru' },
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0 ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

const platega = {
  id: 'platega',
  name: 'Platega',
  description: null,
  min_amount_kopeks: 100,
  max_amount_kopeks: 100000000,
  is_available: true,
  quick_amounts: [],
  options: [
    { id: '11', name: 'Карта', description: '' },
    { id: '2', name: 'СБП', description: '' },
  ],
};

// Срок и устройства зашиты литералом и НЕ совпадают с умолчаниями кассы.
const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=90&devices=3';
// Адрес кнопки «Доплатить» бота: без `option` и без `auto` — счёт всё равно выставляется при открытии.
const BOT_LINK = `?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}&amount=99`;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderScreen(search: string, productionRetry = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: productionRetry ? 1 : false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(['payment-methods'], [platega]);
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/balance/top-up/platega${search}`]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <Routes>
            <Route path="/balance/top-up/result" element={<output data-testid="result" />} />
            <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
            <Route path="*" element={<output data-testid="elsewhere" />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  return queryClient;
}

async function settle() {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const location = () => screen.getByTestId('location').textContent;

function accepted(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: '501',
    payment_url: 'https://app.platega.io/pay/501',
    amount_kopeks: 9900,
    amount_rubles: 99,
    status: 'pending',
    expires_at: null,
    intent_status: 'accepted',
    period_days: 90,
    devices: 3,
    price_kopeks: 14900,
    ...overrides,
  };
}

function renderFor(methodId: string, search: string, methods = [platega]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['payment-methods'], methods);
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/balance/top-up/${methodId}${search}`]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <Routes>
            <Route path="/balance/top-up/result" element={<output data-testid="result" />} />
            <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
            <Route path="*" element={<output data-testid="elsewhere" />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  return queryClient;
}
const withReturn = (ret: string, extra = '') =>
  `?returnTo=${encodeURIComponent(ret)}&amount=99${extra}`;
const setVisibility = (state: 'hidden' | 'visible') =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

describe('PROBE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
    getPaymentMethods.mockResolvedValue([platega]);
    getOptions.mockResolvedValue({
      eligible: true,
      topup_intent_enabled: true,
      tariff: { id: 3, name: 'T' },
    });
    createTopUp.mockResolvedValue(accepted());
  });
  afterEach(() => {
    cleanup();
    // @ts-expect-error probe cleanup
    delete document.visibilityState;
  });

  it.each(['success', 'failure'])(
    '16в-3 request2: deferred options refetch exposes loading until %s and never creates an ordinary invoice',
    async (outcome) => {
      getOptions.mockRejectedValue(new Error('network'));
      renderScreen(BOT_LINK, true);
      await screen.findByRole('alert');
      expect(createTopUp).not.toHaveBeenCalled();
      let resolveOptions!: (options: unknown) => void;
      let rejectOptions!: (error: Error) => void;
      getOptions.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveOptions = resolve;
            rejectOptions = reject;
          }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
      await settle();
      expect(screen.getByRole('status', { name: 'common.loading' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(createTopUp).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome === 'success')
          resolveOptions({
            eligible: true,
            topup_intent_enabled: true,
            tariff: { id: 3, name: 'T' },
          });
        else rejectOptions(new Error('still offline'));
      });
      if (outcome === 'success') {
        await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(1));
        expect(createTopUp.mock.calls[0][3]).toEqual({ period_days: 90, devices: 3 });
        expect(screen.queryByRole('status', { name: 'common.loading' })).toBeNull();
      } else {
        await screen.findByRole('alert');
        expect(createTopUp).not.toHaveBeenCalled();
        expect(screen.queryByRole('status', { name: 'common.loading' })).toBeNull();
      }
    },
  );

  it('P-O06 rate limit гасит прежний счёт', async () => {
    renderScreen(BOT_LINK);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'СБП' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /balance\.topUpOrder\.pay/ })).toBeNull();
  });

  it('P-O08 account_erasure — без оплаты, с поддержкой', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'account_erasure' }),
    );
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
    expect(screen.getByText('balance.topUpOrder.writeSupport')).toBeTruthy();
  });

  it('P-O51 unavailable — без кнопки поддержки', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'unavailable' }),
    );
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
    expect(screen.queryByText('balance.topUpOrder.writeSupport')).toBeNull();
  });

  it('P-O12 ответ без intent_status — счёт показан', async () => {
    createTopUp.mockResolvedValue(accepted({ intent_status: undefined }));
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.getByText('balance.openPaymentPage')).toBeTruthy();
  });

  it('P-O22 после «да» другая покупка — вопрос снова, а не отказ', async () => {
    const q = (at: string) =>
      accepted({ intent_status: 'already_fulfilled', payment_url: null, purchased_at: at });
    createTopUp
      .mockResolvedValueOnce(q('2026-10-08T19:00:00+00:00'))
      .mockResolvedValueOnce(q('2026-10-08T20:00:00+00:00'));
    renderScreen(BOT_LINK);
    await settle();
    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodYes'));
    await settle();
    expect(screen.queryByText('balance.topUpOrder.confirmRejected')).toBeNull();
    expect(screen.getByText('balance.topUpOrder.morePeriodYes')).toBeTruthy();
  });

  it('P-O23 already_fulfilled без purchased_at — не «отказ»', async () => {
    createTopUp.mockResolvedValue(
      accepted({
        intent_status: 'already_fulfilled',
        payment_url: null,
        purchased_at: null,
        period_days: null,
        devices: null,
      }),
    );
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.queryByText('balance.topUpOrder.confirmRejected')).toBeNull();
    expect(screen.getByText('balance.topUpOrder.fulfilledRecent')).toBeTruthy();
  });

  it('P-O27 уход приложения (hidden) после «Оплатить» — не на результат', async () => {
    renderScreen(BOT_LINK);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /balance\.topUpOrder\.pay/ }));
    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(location()).toContain('/balance/top-up/platega');
  });

  it('P-O28 возврат в приложение без «Оплатить» — остаёмся', async () => {
    renderScreen(BOT_LINK);
    await settle();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(location()).toContain('/balance/top-up/platega');
  });

  it('P-O31 уведомление без номера платежа — остаёмся', async () => {
    createTopUp.mockResolvedValue(
      accepted({
        intent_status: 'open_order',
        payment_url: null,
        payment_id: null,
        checkout_public_id: 'CO-1',
      }),
    );
    renderScreen(BOT_LINK);
    await settle();
    await act(async () => {
      useSuccessNotification.getState().show({ type: 'balance_topup' });
    });
    expect(location()).toContain('/balance/top-up/platega');
    useSuccessNotification.getState().hide();
  });

  // Волна 2 (`93c97231`): ручной выбор способа — ВСЕГДА явная смена (сервер без флага отдал бы прежний живой счёт
  // любым способом, мина OR); проба мутатора на `8a58f513` ждала обратного — переписана на новое правило.
  it('P-O33 выбор способа при обычном пополнении — явная смена способа', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'method_not_supported' }),
    );
    renderScreen(BOT_LINK);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
      change_method: true,
    });
  });

  it('P-O36 нажатие на уже выбранный способ — нового счёта нет', async () => {
    renderScreen(BOT_LINK);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'СБП' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('P-O45 счёт не выдан — способы видны', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'invoice_not_created', payment_url: null, payment_id: null }),
    );
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.getByRole('button', { name: 'Карта' })).toBeTruthy();
  });

  it('P-A04 другой способ оплаты с адресом заказа — прежний экран', async () => {
    const yoo = { ...platega, id: 'yookassa', name: 'YK' };
    getPaymentMethods.mockResolvedValue([yoo]);
    renderFor('yookassa', withReturn(CHECKOUT_RETURN), [yoo]);
    await settle();
    expect(getOptions).not.toHaveBeenCalled();
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.getByText('balance.enterAmount')).toBeTruthy();
  });

  for (const [tag, ret] of [
    ['A06 без period', '/subscription/purchase?from=checkout&devices=3'],
    ['A07 без devices', '/subscription/purchase?from=checkout&period=90'],
    ['A16 period=0', '/subscription/purchase?from=checkout&period=0&devices=3'],
    ['A15 period=1.5', '/subscription/purchase?from=checkout&period=1.5&devices=3'],
  ] as const) {
    it(`P-${tag}: адрес не заказа — прежний экран, автосчёт работает`, async () => {
      renderFor('platega', withReturn(ret, '&option=2&auto=1'));
      await settle();
      expect(screen.queryByText('balance.topUpOrder.title')).toBeNull();
      expect(createTopUp).toHaveBeenCalledTimes(1);
      expect(createTopUp.mock.calls[0][3]).toBeUndefined();
    });
  }

  it('P-A19 пока признак не ответил — формы суммы нет', async () => {
    getOptions.mockReturnValue(new Promise(() => {}));
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.queryByText('balance.enterAmount')).toBeNull();
  });

  it('P-A10 обычный счёт в полёте — на «Оплату заказа» не переключаемся', async () => {
    // 16в-3/PF: обычный счёт допустим только после подтверждённого отключения, не после сетевой ошибки.
    getOptions.mockResolvedValueOnce({ eligible: true, topup_intent_enabled: false });
    createTopUp.mockReturnValue(new Promise(() => {}));
    const queryClient = renderScreen(`${BOT_LINK}&option=2&auto=1`);
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    expect(screen.queryByText('balance.topUpOrder.title')).toBeNull();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('P-A11 обычный счёт без ссылки — на «Оплату заказа» не переключаемся', async () => {
    // 16в-3/PF: обычный счёт допустим только после подтверждённого отключения, не после сетевой ошибки.
    getOptions.mockResolvedValueOnce({ eligible: true, topup_intent_enabled: false });
    createTopUp.mockResolvedValue(accepted({ intent_status: null, payment_url: null }));
    const queryClient = renderScreen(`${BOT_LINK}&option=2&auto=1`);
    await settle();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    expect(screen.queryByText('balance.topUpOrder.title')).toBeNull();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('P-A05 адрес заказа без суммы — прежний экран, уведомление об оплате уводит как раньше', async () => {
    renderFor('platega', `?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);
    await settle();
    expect(screen.getByText('balance.enterAmount')).toBeTruthy();
    await act(async () => {
      useSuccessNotification.getState().show({ type: 'balance_topup' });
    });
    expect(location()).toBe(CHECKOUT_RETURN);
    useSuccessNotification.getState().hide();
  });

  for (const auto of ['', '&option=2&auto=1']) {
    it(`16в-3 PF: окончательный сбой с retry:1 блокирует обычный POST ${auto || 'вход бота'}`, async () => {
      getOptions.mockRejectedValue(new Error('transport'));
      renderScreen(`${BOT_LINK}${auto}`, true);
      await settle();
      expect(getOptions).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('balance.enterAmount')).toBeNull();
      expect(createTopUp).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
      getOptions.mockResolvedValue({ eligible: true, topup_intent_enabled: true });
      fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
      await settle();
      expect(createTopUp).toHaveBeenCalledTimes(1);
      expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '2', {
        period_days: 90,
        devices: 3,
      });
    });
  }

  it('16в-3 request2: warm cached failed options expose loading during deferred retry', async () => {
    getOptions.mockResolvedValue({ eligible: true, topup_intent_enabled: false });
    const client = renderScreen(BOT_LINK);
    await settle();
    getOptions.mockRejectedValue(new Error('transport'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await screen.findByRole('alert');
    expect(createTopUp).not.toHaveBeenCalled();
    let resolveOptions!: (options: unknown) => void;
    getOptions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOptions = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await settle();
    const pending = client.getQueryState(['device-first-options']);
    expect(pending?.data).toMatchObject({ topup_intent_enabled: false });
    expect(pending?.status).toBe('error');
    expect(pending?.fetchStatus).toBe('fetching');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeNull();
    expect(createTopUp).not.toHaveBeenCalled();
    await act(async () => {
      resolveOptions({ eligible: true, topup_intent_enabled: true });
    });
    await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(1));
    expect(createTopUp.mock.calls[0][3]).toEqual({ period_days: 90, devices: 3 });
  });

  it('16в-3 PF: прогретые данные и отказ refetch не разрешают обычное пополнение', async () => {
    getOptions.mockResolvedValue({ eligible: true, topup_intent_enabled: false });
    const client = renderScreen(BOT_LINK);
    await settle();
    getOptions.mockRejectedValue(new Error('transport'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    expect(screen.queryByText('balance.enterAmount')).toBeNull();
    expect(createTopUp).not.toHaveBeenCalled();
  });

  for (const methods of [[platega], [{ ...platega, options: [{ id: '13', name: 'Крипта' }] }]]) {
    it(`16в-3: крипта требует явный выбор до счёта (${methods[0].options.length})`, async () => {
      getPaymentMethods.mockResolvedValue(methods);
      renderFor('platega', `${BOT_LINK}&chooseMethod=1`, methods);
      await settle();
      expect(createTopUp).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          methods[0].options.length > 1
            ? 'balance.topUpOrder.chooseSupportedMethod'
            : 'balance.topUpOrder.noSupportedMethod',
        ),
      ).toBeTruthy();
      if (methods[0].options.length > 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
        await settle();
        expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '11', {
          period_days: 90,
          devices: 3,
          change_method: true,
        });
      }
    });
  }
  // Независимый мутационный скептик: прежние сторожа пропускали эти семь веток.
  it('G-M04: no-URL обычный ответ + ошибка options блокируют ручной второй POST', async () => {
    getOptions.mockResolvedValueOnce({ eligible: true, topup_intent_enabled: false });
    createTopUp.mockResolvedValue(accepted({ intent_status: null, payment_url: null }));
    const client = renderScreen(`${BOT_LINK}&option=2&auto=1`);
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    getOptions.mockRejectedValue(new Error('transport'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'balance.getPaymentLink' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('G-M05: no-URL обычный ответ + позднее true блокируют ручной второй POST', async () => {
    getOptions.mockResolvedValueOnce({ eligible: true, topup_intent_enabled: false });
    createTopUp.mockResolvedValue(accepted({ intent_status: null, payment_url: null }));
    const client = renderScreen(`${BOT_LINK}&option=2&auto=1`);
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'balance.getPaymentLink' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('G-M11: бот без chooseMethod при только crypto options не шлёт null/default POST', async () => {
    const onlyCrypto = [{ ...platega, options: [{ id: '13', name: 'Крипта', description: '' }] }];
    getPaymentMethods.mockResolvedValue(onlyCrypto);
    renderFor('platega', BOT_LINK, onlyCrypto);
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.getByText('balance.topUpOrder.noSupportedMethod')).toBeTruthy();
  });

  it('G-M14: явный выбор при единственной карте виден и отправляет именно 11/change_method', async () => {
    const oneCard = [{ ...platega, options: [{ id: '11', name: 'Карта', description: '' }] }];
    getPaymentMethods.mockResolvedValue(oneCard);
    renderFor('platega', `${BOT_LINK}&chooseMethod=1`, oneCard);
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
      change_method: true,
    });
  });
  it('16в-3 PF: ошибка цен после accepted сохраняет прежний счёт', async () => {
    const client = renderScreen(BOT_LINK);
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    const saved = localStorage.getItem('topup_pending_payment');
    getOptions.mockRejectedValue(new Error('transport'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    expect(screen.getByText('balance.topUpOrder.title')).toBeTruthy();
    expect(screen.queryByText('balance.topUpOrder.loadError')).toBeNull();
    expect(localStorage.getItem('topup_pending_payment')).toBe(saved);
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('16в-3: выбранная карта исчезла из списка — нет подмены на СБП', async () => {
    const onlySbp = [{ ...platega, options: [{ id: '2', name: 'СБП' }] }];
    getPaymentMethods.mockResolvedValue(onlySbp);
    renderFor('platega', `${BOT_LINK}&option=11&auto=1`, onlySbp);
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'СБП' }));
    await settle();
    expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '2', {
      period_days: 90,
      devices: 3,
      change_method: true,
    });
  });
});
