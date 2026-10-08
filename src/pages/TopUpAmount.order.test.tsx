// @vitest-environment jsdom

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

function renderScreen(search: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

describe('TopUpAmount — «Оплата заказа» (ВК-16 · 16в-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
    getPaymentMethods.mockResolvedValue([platega]);
    getOptions.mockResolvedValue({
      eligible: true,
      topup_intent_enabled: true,
      tariff: { id: 3, name: 'Базовый <&>' },
    });
    createTopUp.mockResolvedValue(accepted());
  });
  afterEach(cleanup);

  // Контрольный: кому доплата под заказ не включена — прежний экран суммы, счёт не выставляется сам.
  it('не включено — прежний экран суммы без единого изменения', async () => {
    getOptions.mockResolvedValue({ eligible: true, topup_intent_enabled: false });
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.enterAmount')).toBeTruthy();
    expect(screen.queryByText('balance.topUpOrder.title')).toBeNull();
    expect(createTopUp).not.toHaveBeenCalled();
  });

  it('счёт выставляется при открытии ОДИН раз, с намерением и предвыбранным СБП', async () => {
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpOrder.title')).toBeTruthy();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '2', { period_days: 90, devices: 3 });
  });

  it('«принято»: чек из ответа сервера, одна кнопка оплаты и обещание', async () => {
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpOrder.price')).toBeTruthy();
    expect(screen.getByText('149 ₽')).toBeTruthy();
    expect(screen.getByText('−50 ₽')).toBeTruthy();
    expect(screen.getByText('99 ₽')).toBeTruthy();
    expect(screen.getByText('balance.topUpOrder.autoPromise')).toBeTruthy();
    expect(screen.queryByText('balance.enterAmount')).toBeNull();
    const pay = screen.getByRole('button', { name: /balance\.topUpOrder\.pay/ });
    expect(pay.textContent).toContain('99 ₽');
    expect(screen.getByText(/Базовый <&>/)).toBeTruthy();
  });

  it('ушёл в банк и вернулся — на экран ожидания по номеру платежа', async () => {
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /balance\.topUpOrder\.pay/ }));
    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/501');
    const saved = JSON.parse(localStorage.getItem('topup_pending_payment') ?? '{}');
    expect(saved.payment_id).toBe('501');
    expect(saved.return_to).toBe(CHECKOUT_RETURN);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(location()).toBe(
      `/balance/top-up/result?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // Т1 и мина EC: уведомление «деньги пришли» уводит на экран ожидания ЗАКАЗА, а не на кассу.
  it('уведомление об оплате — на экран ожидания, а не на кассу', async () => {
    renderScreen(BOT_LINK);
    await settle();

    await act(async () => {
      useSuccessNotification.getState().show({ type: 'balance_topup' });
    });
    expect(location()).toBe(
      `/balance/top-up/result?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    useSuccessNotification.getState().hide();
  });

  it('другой способ при живом счёте — новый счёт ЯВНОЙ сменой способа', async () => {
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

  it('«уже есть счёт» — тот же счёт, его способ отмечен, обещание на месте', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'already_paying', payment_option: '11', price_kopeks: 14900 }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpOrder.alreadyPaying')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Карта' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('balance.topUpOrder.autoPromise')).toBeTruthy();
  });

  it('обычное пополнение (сервер не принял намерение) — без обещания', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'method_not_supported' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpOrder.ordinary')).toBeTruthy();
    expect(screen.queryByText('balance.topUpOrder.autoPromise')).toBeNull();
    expect(screen.getByText('balance.openPaymentPage')).toBeTruthy();
  });

  it('деньги по заказу уже пришли — сразу ждём исход, второй счёт не выставляем', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'already_paid', payment_url: null, status: 'paid' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(location()).toBe(
      `/balance/top-up/result?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    expect(JSON.parse(localStorage.getItem('topup_pending_payment') ?? '{}').payment_id).toBe(
      '501',
    );
  });

  it('есть открытый заказ — к нему по номеру', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'open_order', payment_url: null, checkout_public_id: 'CO-5' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.queryByText('balance.topUpOrder.autoPromise')).toBeNull();
    fireEvent.click(screen.getByText('balance.topUpOrder.toMyOrder'));
    expect(location()).toBe('/subscription/purchase?checkout=CO-5');
  });

  it('заказ на проверке — в поддержку', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'order_on_review', payment_url: null }),
    );
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.writeSupport'));
    expect(location()).toBe('/support');
  });

  it('«уже оформлено» — вопрос; «да» несёт момент той покупки как есть и запоминается', async () => {
    createTopUp.mockResolvedValueOnce(
      accepted({
        intent_status: 'already_fulfilled',
        payment_id: null,
        payment_url: null,
        amount_kopeks: 0,
        period_days: 30,
        devices: 1,
        price_kopeks: 39900,
        purchased_at: '2026-10-08T19:00:00.123456+00:00',
        subscription_end_date: '2026-11-07T19:00:00+00:00',
      }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText(/balance\.topUpOrder\.fulfilledWhat/)).toBeTruthy();
    expect(screen.getByText(/balance\.topUpOrder\.fulfilledUntil/)).toBeTruthy();
    const question = screen.getByText(/balance\.topUpOrder\.morePeriodQuestion/);
    expect(question.textContent).toContain('399 ₽');
    expect(screen.queryByText('balance.topUpOrder.autoPromise')).toBeNull();
    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodYes'));
    await settle();

    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '2', {
      period_days: 90,
      devices: 3,
      confirmed_purchase_at: '2026-10-08T19:00:00.123456+00:00',
    });
    expect(screen.getByText('balance.topUpOrder.autoPromise')).toBeTruthy();

    // Повторное открытие того же заказа не задаёт вопрос снова: момент «да» едет с первым же запросом.
    cleanup();
    renderScreen(BOT_LINK);
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '2', {
      period_days: 90,
      devices: 3,
      confirmed_purchase_at: '2026-10-08T19:00:00.123456+00:00',
    });
  });

  it('«нет» на вопрос — на Главную, нового счёта нет', async () => {
    createTopUp.mockResolvedValue(
      accepted({
        intent_status: 'already_fulfilled',
        payment_url: null,
        purchased_at: '2026-10-08T19:00:00+00:00',
      }),
    );
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodNo'));
    expect(location()).toBe('/');
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // Защита от отката 3а: сервер спросил ПРО ТУ ЖЕ покупку после нашего «да» — ответ не принят, круга нет.
  it('сервер не принял «да» — ошибка, а не тот же вопрос по кругу', async () => {
    const asked = accepted({
      intent_status: 'already_fulfilled',
      payment_url: null,
      purchased_at: '2026-10-08T19:00:00+00:00',
    });
    createTopUp.mockResolvedValue(asked);
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodYes'));
    await settle();
    expect(screen.getByText('balance.topUpOrder.confirmRejected')).toBeTruthy();
    expect(screen.queryByText('balance.topUpOrder.morePeriodYes')).toBeNull(); // Повтор бессмысленен — дверь назад к заказу.
    expect(screen.queryByText('common.retry')).toBeNull();
    fireEvent.click(screen.getByText('balance.topUpOrder.backToOrder'));
    expect(location()).toBe(CHECKOUT_RETURN);
  });

  // 🔴 Волна 1 (три линзы, P1): после «да» сменить способ было нельзя — сервер спрашивал снова, второе «да» без смены
  // способа возвращало старый счёт. Теперь каждый запрос несёт «да», а «да» повторяет запрос со сменой способа.
  it('после «да» другой способ — новый счёт этим способом, без второго вопроса', async () => {
    const question = accepted({
      intent_status: 'already_fulfilled',
      payment_url: null,
      purchased_at: '2026-10-08T19:00:00+00:00',
    });
    createTopUp.mockResolvedValueOnce(question).mockResolvedValue(accepted());
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodYes'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
      confirmed_purchase_at: '2026-10-08T19:00:00+00:00',
      change_method: true,
    });
  });

  it('вопрос пришёл на смену способа — «да» повторяет смену способа', async () => {
    createTopUp
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(
        accepted({
          intent_status: 'already_fulfilled',
          payment_url: null,
          purchased_at: '2026-10-08T19:00:00+00:00',
        }),
      )
      .mockResolvedValue(accepted({ payment_url: 'https://app.platega.io/pay/777' }));
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    fireEvent.click(screen.getByText('balance.topUpOrder.morePeriodYes'));
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
      confirmed_purchase_at: '2026-10-08T19:00:00+00:00',
      change_method: true,
    });
  });

  // Волна 1 (P1): ошибка на смене способа — рядом НЕ остаётся «Оплатить» прежнего счёта; повтор — та же смена.
  it('ошибка на смене способа — кнопки оплаты старого счёта нет, повтор повторяет смену способа', async () => {
    createTopUp.mockResolvedValueOnce(accepted()).mockRejectedValueOnce(new Error('502'));
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('common.error');
    expect(screen.queryByRole('button', { name: /balance\.topUpOrder\.pay/ })).toBeNull();
    createTopUp.mockResolvedValue(accepted({ payment_url: 'https://app.platega.io/pay/888' }));
    fireEvent.click(screen.getByText('common.retry'));
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
      change_method: true,
    });
  });

  it('сырой текст сервера по-английски человеку не показываем', async () => {
    createTopUp.mockRejectedValueOnce({
      response: { data: { detail: 'Selected Platega method is unavailable' } },
    });
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('common.error')).toBeTruthy();
    expect(screen.queryByText(/Selected Platega/)).toBeNull();
  });

  it('обычное пополнение при запрете покупок — в поддержку, платить не зовём', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'restricted' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpResult.intent.reasons.restricted')).toBeTruthy();
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
    expect(screen.queryByText('balance.topUpOrder.ordinary')).toBeNull();
    fireEvent.click(screen.getByText('balance.topUpOrder.writeSupport'));
    expect(location()).toBe('/support');
  });

  it('обычное пополнение, заказ нельзя оформить — платить не зовём', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'unavailable' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('balance.topUpResult.intent.reasons.unavailable')).toBeTruthy();
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
  });

  it('обычное пополнение — сумма видна до банка', async () => {
    createTopUp.mockResolvedValue(
      accepted({
        intent_status: 'ordinary',
        intent_reason: 'method_not_supported',
        amount_kopeks: 9900,
      }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText(/balance\.topUpOrder\.toPay: 99 ₽/)).toBeTruthy();
  });

  it('живой счёт способом, которого нет в списке, — ни один способ не отмечен', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'already_paying', payment_option: '12' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByRole('button', { name: 'СБП' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Карта' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'СБП' }));
    await settle();
    expect(createTopUp).toHaveBeenLastCalledWith(9900, 'platega', '2', {
      period_days: 90,
      devices: 3,
      change_method: true,
    });
  });

  it('баланса уже хватает — назад в кассу', async () => {
    createTopUp.mockResolvedValue(accepted({ intent_status: 'balance_covers', payment_url: null }));
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.backToOrder'));
    expect(location()).toBe(CHECKOUT_RETURN);
  });

  it('счёт не выдан — текст ВК-15 и повтор', async () => {
    createTopUp.mockResolvedValueOnce(
      accepted({ intent_status: 'invoice_not_created', payment_url: null, payment_id: null }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('deviceFirst.errorProviderNoInvoice')).toBeTruthy();
    fireEvent.click(screen.getByText('common.retry'));
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(2);
    expect(screen.getByText('balance.topUpOrder.autoPromise')).toBeTruthy();
  });

  it('касса со своим способом (option=11, auto=1) — счёт этим способом и ровно один', async () => {
    renderScreen(`${BOT_LINK}&option=11&auto=1`);
    await settle();

    expect(createTopUp).toHaveBeenCalledTimes(1);
    expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '11', {
      period_days: 90,
      devices: 3,
    });
  });

  // Волна 1: признак не ответил — прежний экран выставил обычный счёт; признак перечитался — на «Оплату заказа» не
  // переключаемся, иначе на один заказ два живых счёта.
  it('обычный счёт уже выставлен — на «Оплату заказа» не переключаемся', async () => {
    getOptions.mockRejectedValueOnce(new Error('сбой'));
    createTopUp.mockResolvedValue(
      accepted({ intent_status: null, payment_url: 'https://app.platega.io/pay/plain' }),
    );
    const queryClient = renderScreen(`${BOT_LINK}&option=2&auto=1`);
    await settle();
    expect(screen.getByText('balance.paymentReady')).toBeTruthy();

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['device-first-options'] });
    });
    await settle();
    expect(screen.queryByText('balance.topUpOrder.title')).toBeNull();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // Волна 2 (прогон сценария, критик полноты): окно может не уйти в фон — выход к исходу по номеру платежа.
  it('«Я уже оплатил» — на экран ожидания по номеру платежа, нового счёта нет', async () => {
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.paidAlready'));
    expect(location()).toBe(
      `/balance/top-up/result?returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    expect(JSON.parse(localStorage.getItem('topup_pending_payment') ?? '{}').payment_id).toBe(
      '501',
    );
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('новый счёт сменой способа — «прежний не оплачивайте»; первый счёт — без этой строки', async () => {
    renderScreen(BOT_LINK);
    await settle();
    expect(screen.queryByText('balance.topUpOrder.oldInvoiceVoid')).toBeNull();

    createTopUp.mockResolvedValue(
      accepted({ payment_id: '502', payment_url: 'https://app.platega.io/pay/502' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    await settle();
    expect(screen.getByText('balance.topUpOrder.oldInvoiceVoid')).toBeTruthy();
  });

  it('ошибка первого счёта, потом выбор способа — всё равно явная смена способа', async () => {
    createTopUp.mockRejectedValueOnce(new Error('502'));
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

  it('криптовалюты на «Оплате заказа» нет; касса с криптой — счёт по СБП', async () => {
    const withCrypto = {
      ...platega,
      options: [...platega.options, { id: '13', name: 'Крипта', description: '' }],
    };
    getPaymentMethods.mockResolvedValue([withCrypto]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['payment-methods'], [withCrypto]);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/balance/top-up/platega${BOT_LINK}&option=13&auto=1`]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await settle();

    expect(screen.queryByRole('button', { name: 'Крипта' })).toBeNull();
    expect(createTopUp).toHaveBeenCalledWith(9900, 'platega', '2', { period_days: 90, devices: 3 });
  });

  it('скрытый счёт обычного пополнения (заказ нельзя оформить) в память ожидания не кладём', async () => {
    createTopUp.mockResolvedValue(
      accepted({ intent_status: 'ordinary', intent_reason: 'unavailable' }),
    );
    renderScreen(BOT_LINK);
    await settle();

    expect(localStorage.getItem('topup_pending_payment')).toBeNull();
  });

  it('«Изменить заказ» — назад в кассу', async () => {
    renderScreen(BOT_LINK);
    await settle();

    fireEvent.click(screen.getByText('balance.topUpOrder.changeOrder'));
    expect(location()).toBe(CHECKOUT_RETURN);
  });

  // Контрольный: адрес возврата не касса (соседние экраны покупки) — «Оплаты заказа» нет и признак не спрашиваем.
  it('без метки кассы — прежний экран, признак не спрашиваем', async () => {
    renderScreen(`?returnTo=${encodeURIComponent('/subscription/purchase')}&amount=99`);
    await settle();

    expect(screen.getByText('balance.enterAmount')).toBeTruthy();
    expect(getOptions).not.toHaveBeenCalled();
  });

  it('ответ сервера об ошибке — понятный текст и повтор', async () => {
    createTopUp.mockRejectedValueOnce({ response: { data: { detail: [{ msg: 'x' }] } } });
    renderScreen(BOT_LINK);
    await settle();

    expect(screen.getByText('common.error')).toBeTruthy();
    fireEvent.click(screen.getByText('common.retry'));
    await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(2));
  });
});
