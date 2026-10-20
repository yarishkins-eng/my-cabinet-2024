// @vitest-environment jsdom

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, MemoryRouter, useLocation, useSearchParams } from 'react-router';
import TopUpAmount from '../../../pages/TopUpAmount';
import TopUpResult from '../../../pages/TopUpResult';
import { useSuccessNotification } from '../../../store/successNotification';
import {
  loadTopUpPendingInfo,
  loadConfirmedPurchase,
  saveConfirmedPurchase,
} from '../../../utils/topUpStorage';
import { resetRateLimit, RATE_LIMIT_KEYS } from '../../../utils/rateLimit';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
} from '@/api/deviceFirst';

vi.mock('@/api/deviceFirst', () => ({
  deviceFirstApi: {
    getOptions: vi.fn(),
    create: vi.fn(),
    clearCreateIntents: vi.fn(),
    get: vi.fn(),
    getOpen: vi.fn(),
    getPendingPayment: vi.fn(),
    confirm: vi.fn(),
    arm: vi.fn(),
    commit: vi.fn(),
    nativeLaunch: vi.fn(),
    payDirect: vi.fn(),
    nativeLaunchDirect: vi.fn(),
    cancel: vi.fn(),
    abandon: vi.fn(),
    paymentMethods: vi.fn(),
    createPaymentAttempt: vi.fn(),
    resumeInvoice: vi.fn(),
  },
}));
// 🔴 Этап Б-2. Касса читает минимум провайдера БАЛАНСНЫМ запросом (`['payment-methods']`),
// и его модуль тянет за собой настоящий `i18n` — а он в тестовой среде не поднимается.
// Мок держит запрос под контролем: по умолчанию сервер молчит, значит сумма остаётся сырой
// разницей, а автосоздание счёта выключено. Тест, которому нужен минимум, подменяет ответ сам.
const {
  createTopUp,
  getPendingPayment,
  getLatestPayment,
  checkPaymentStatus,
  getBalancePaymentMethods,
} = vi.hoisted(() => ({
  createTopUp: vi.fn(),
  getPendingPayment: vi.fn(),
  getLatestPayment: vi.fn(),
  checkPaymentStatus: vi.fn(),
  getBalancePaymentMethods: vi.fn(),
}));
vi.mock('@/api/balance', () => ({
  balanceApi: {
    createTopUp,
    getPendingPayment,
    getLatestPayment,
    checkPaymentStatus,
    getPaymentMethods: getBalancePaymentMethods,
  },
}));
// 🔴 Пункт 1 реза 22.08.2026. `hideBackButton`/`showBackButton` больше не нужны: экран
// не подменяется, поэтому кнопку «Назад» гасить не от чего. Вместо них — `openLink`
// платформы, которым Телеграм открывает провайдера ОТДЕЛЬНОЙ поверхностью, оставляя
// мини-приложение в живых. Ходим через адаптер, как требует `eslint.config.js:60-64`.
const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({
    openLink,
    openTelegramLink: vi.fn(),
    openInvoice: vi.fn(),
    platform: 'telegram',
    haptic: { notification: vi.fn(), impact: vi.fn(), selection: vi.fn() },
  }),
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn(), selection: vi.fn() }),
}));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast }),
}));
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    convertAmount: (value: number) => value,
    convertToRub: (value: number) => value,
    targetCurrency: 'RUB',
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ru' },
    t: (
      key: string,
      values?: {
        count?: number;
        amount?: string;
        balance?: string;
        total?: string;
        method?: string;
      },
    ) => {
      if (values?.amount) return `${key}:${values.amount}`;
      // 🔴 РЕК-8б: у строки про арифметику баланса ДВА числа, и оба обязаны доехать.
      // Без этой ветки мок вернул бы голый ключ, и сторож проверял бы наличие строки,
      // а не то, какие числа в неё подставлены.
      if (values?.balance !== undefined && values?.total !== undefined)
        return `${key}:${values.balance}:${values.total}`;
      // 🔴 РЕК-16: то же и с названием выбранного способа. Ветка стоит НИЖЕ денежной, иначе
      // `paymentMethodAmount` (у него есть и `method`, и `amount`) сменил бы форму, и все
      // прежние ожидания вида `…:450 ₽` стали бы проверять другое.
      if (values?.method !== undefined) return `${key}:${values.method}`;
      // 🔴 РЕК-16, волна 2: строка про полную оплату теперь называет ЧИСЛО — сколько денег
      // останется лежать. Без этой ветки мок вернул бы голый ключ, и сторож проверял бы
      // наличие строки, а не сумму в ней.
      if (values?.balance !== undefined) return `${key}:${values.balance}`;
      if (values?.count === undefined) return key;
      return `${key}:${values.count}`;
    },
  }),
}));

const options: DeviceFirstOptions = {
  eligible: true,
  tariff: {
    id: 7,
    name: 'Premium',
    traffic_limit_gb: 0,
    base_device_limit: 2,
    pricing_revision: 3,
  },
  period_options: [30],
  default_period_days: 30,
  device_options: [2],
  balance_kopeks: 10000,
  price_matrix: [
    {
      period_days: 30,
      prices: [
        {
          device_limit: 2,
          price_kopeks: 45000,
          breakdown: {
            base_price_kopeks: 45000,
            devices_price_kopeks: 0,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
  ],
};
const topUpMethodsResponse = [{ id: 'platega', is_available: true, min_amount_kopeks: 1 }];
const staleTopUp = [{ ...topUpMethodsResponse[0], is_available: false, min_amount_kopeks: 10000 }];

function checkout(
  uiState: DeviceFirstCheckout['ui_state'],
  shortageKopeks = 35000,
): DeviceFirstCheckout {
  return {
    id: 'checkout-owned',
    tariff_id: 7,
    target_subscription_id: null,
    period_days: 30,
    selected_device_limit: 2,
    price_breakdown: options.price_matrix![0].prices[0].breakdown,
    quoted_price_kopeks: 45000,
    max_price_kopeks: 45000,
    settlement_mode: 'legacy_deposit',
    tariff_total_kopeks: 45000,
    wallet_applied_kopeks: 0,
    external_payable_kopeks: 0,
    funding_mode: null,
    lifecycle_state: uiState,
    funding_state: shortageKopeks ? 'partial' : 'funded',
    provisioning_state: 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: null,
    current_device_limit: null,
    current_subscription_is_trial: null,
    estimated_end_at: '2026-08-29T12:00:00Z',
    expires_at: '2026-08-02T12:15:00Z',
    balance_kopeks: 45000 - shortageKopeks,
    shortage_kopeks: shortageKopeks,
    top_up_surplus_kopeks: 0,
  };
}

function directInvoice(): DeviceFirstCheckout {
  return {
    ...checkout('awaiting_payment'),
    settlement_mode: 'direct_purchase_v2',
    funding_state: 'invoice_pending',
    external_payable_kopeks: 45000,
    balance_kopeks: 0,
  };
}

const plategaPayPayload = {
  period_days: 30,
  selected_device_limit: 2,
  funding_mode: 'platega',
  method_key: 'sbp',
  expected_tariff_total_kopeks: 45000,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// The page derives the restored checkout id from the URL; the test harness
// mirrors that exactly so navigation (drain, Back, acceptCheckout) behaves
// like production instead of freezing a static prop.
function ConfiguratorFromRoute({
  options: routeOptions = options,
  fixtureCheckout,
  fixtureMethods,
}: {
  options?: DeviceFirstOptions;
  fixtureCheckout?: DeviceFirstCheckout;
  fixtureMethods?: Array<{ key: string; provider_code: number }>;
}) {
  const [searchParams] = useSearchParams();
  return (
    <DeviceFirstConfigurator
      options={routeOptions}
      initialCheckoutId={searchParams.get('checkout')}
      fixtureCheckout={fixtureCheckout}
      fixtureMethods={fixtureMethods}
    />
  );
}

function renderConfigurator(
  props: {
    fixtureCheckout?: DeviceFirstCheckout;
    fixtureMethods?: Array<{ key: string; provider_code: number }>;
    options?: DeviceFirstOptions;
    initialPath?: string;
    seed?: (client: QueryClient) => void;
  } = {},
) {
  const { initialPath = '/subscription/purchase', seed, ...componentProps } = props;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(queryClient);
  // 🔴 РЕК-16: клиент запросов отдаётся наружу. Без него из теста нельзя выжать ПЕРЕЗАПРОС —
  // а два P1 волны 1 живут именно в нём: список способов уже загружен, а повторный запрос упал.
  return {
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <ConfiguratorFromRoute {...componentProps} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
    queryClient,
  };
}

vi.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser: vi.fn() }),
}));

const flowMethods = [
  {
    id: 'platega',
    name: 'Platega',
    description: null,
    is_available: true,
    min_amount_kopeks: 100,
    max_amount_kopeks: 100000000,
    quick_amounts: [],
    options: [
      { id: '11', name: 'Карта', description: '' },
      { id: '2', name: 'СБП', description: '' },
    ],
  },
];
function flowPayment(overrides = {}) {
  return {
    id: 501,
    method: 'platega',
    amount_kopeks: 35000,
    amount_rubles: 350,
    status: 'pending',
    status_text: 'pending',
    status_emoji: '',
    is_paid: false,
    created_at: new Date().toISOString(),
    expires_at: null,
    is_checkable: true,
    payment_url: 'https://pay.example/501',
    intent_outcome: 'waiting',
    intent_payment_id: 501,
    intent_paid: false,
    intent_amount_kopeks: 35000,
    intent_period_days: 30,
    intent_devices: 2,
    intent_quote_kopeks: 45000,
    ...overrides,
  };
}
let flowAfterPayment = false;
function FlowCheckout() {
  const [params] = useSearchParams();
  const incoming = useLocation();
  const [landing] = useState(() => incoming.pathname + incoming.search);
  return (
    <>
      <output data-testid="checkout-landing">{landing}</output>
      <DeviceFirstConfigurator
        options={{
          ...options,
          balance_kopeks: params.has('checkout') ? 0 : flowAfterPayment ? 45000 : 10000,
          topup_intent_enabled: true,
        }}
        initialCheckoutId={params.get('checkout')}
      />
    </>
  );
}
function renderFlow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['payment-methods'], flowMethods);
  render(
    <MemoryRouter
      initialEntries={[
        '/balance/top-up/platega?amount=350&option=11&auto=1&returnTo=' +
          encodeURIComponent('/subscription/purchase?from=checkout&period=30&devices=2'),
      ]}
    >
      <QueryClientProvider client={client}>
        <LocationProbe />
        <Routes>
          <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
          <Route path="/balance/top-up/result" element={<TopUpResult />} />
          <Route path="/subscription/purchase" element={<FlowCheckout />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
async function firstInvoiceBankWaiting() {
  const client = renderFlow();
  const pay = await screen.findByRole('button', { name: /deviceFirst.payCard:/ });
  expect(createTopUp).not.toHaveBeenCalled();
  fireEvent.click(pay);
  await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(1));
  expect(createTopUp).toHaveBeenCalledWith(35000, 'platega', '11', {
    period_days: 30,
    devices: 2,
    change_method: true,
  });
  await waitFor(() => expect(openLink).toHaveBeenCalledWith('https://pay.example/501'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await screen.findByText('balance.topUpResult.intent.waitingTitle');
  expect(getPendingPayment).toHaveBeenCalledWith('platega', 501);
  fireEvent.click(
    screen.getByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
  );
  expect(openLink).toHaveBeenCalledTimes(2);
  expect(createTopUp).toHaveBeenCalledTimes(1);
  getPendingPayment.mockResolvedValue(
    flowPayment({
      intent_outcome: 'processing',
      intent_paid: true,
      is_paid: true,
      status: 'succeeded',
    }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
  });
  await screen.findByText('balance.topUpResult.intent.processingTitle');
  expect(
    screen.queryByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
  ).toBeNull();
  expect(screen.getByTestId('location').textContent).toContain('/balance/top-up/result');
  flowAfterPayment = true;
  return client;
}
function assertNoFrontendDebit() {
  for (const method of [
    'payDirect',
    'nativeLaunchDirect',
    'create',
    'arm',
    'commit',
    'confirm',
    'createPaymentAttempt',
  ] as const) {
    expect(deviceFirstApi[method]).not.toHaveBeenCalled();
  }
  expect(createTopUp).toHaveBeenCalledTimes(1);
}

describe('Mutation skeptic integrated money flow', () => {
  beforeEach(() => {
    flowAfterPayment = false;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
    getBalancePaymentMethods.mockResolvedValue(flowMethods);
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      topup_intent_enabled: true,
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'cards_ru', provider_code: 11 }],
    });
    createTopUp.mockResolvedValue({
      payment_id: '501',
      payment_url: 'https://pay.example/501',
      amount_kopeks: 35000,
      amount_rubles: 350,
      intent_status: 'accepted',
      price_kopeks: 45000,
      period_days: 30,
      devices: 2,
    });
    getPendingPayment.mockResolvedValue(flowPayment());
  });
  afterEach(() => {
    cleanup();
    /* @ts-expect-error configurable test override */ delete document.visibilityState;
  });

  it('S01 first invoice → bank → waiting → processing → ready actual checkout; no repeated invoice/debit', async () => {
    const client = await firstInvoiceBankWaiting();
    vi.mocked(deviceFirstApi.get).mockResolvedValue({
      ...checkout('ready', 0),
      id: 'CO-77',
      created_subscription_id: 911,
    });
    getPendingPayment.mockResolvedValue(
      flowPayment({
        intent_outcome: 'fulfilled',
        intent_paid: true,
        is_paid: true,
        status: 'succeeded',
        intent_checkout_public_id: 'CO-77',
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
    });
    await screen.findByText('balance.topUpResult.intent.readyTitle');
    await screen.findByText('deviceFirst.ready', {}, { timeout: 4000 });
    expect(screen.getByTestId('location').textContent).toBe(
      '/subscription/purchase?checkout=CO-77',
    );
    expect(deviceFirstApi.get).toHaveBeenCalledWith('CO-77');
    assertNoFrontendDebit();
  });

  it('S02 first invoice → bank → waiting → processing → refusal → actual checkout; entering does not debit', async () => {
    const client = await firstInvoiceBankWaiting();
    getPendingPayment.mockResolvedValue(
      flowPayment({
        intent_outcome: 'refused',
        intent_paid: true,
        is_paid: true,
        status: 'succeeded',
        intent_reason: 'price_changed',
        intent_refusal_kind: 'retry',
        intent_offer_kopeks: 45000,
        intent_offer_tariff_name: 'Premium',
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /balance.topUpResult.intent.offer/ }),
    );
    await screen.findByRole('button', { name: /deviceFirst.payAndOrder/ });
    // The actual configurator consumes period/devices/from after seeding its selection.
    expect(screen.getByTestId('checkout-landing').textContent).toBe(
      '/subscription/purchase?from=checkout&period=30&devices=2',
    );
    assertNoFrontendDebit();
  });
});

// ОПЛ-1: ожидания проверяют свойства нового денежного пути, а не старый второй экран.
const oplReturn = '/subscription/purchase?from=checkout&period=30&devices=2';
const paidAt = '2026-10-19T12:00:00.123456Z';
const oplAnswer = (over = {}) => ({
  payment_id: '501',
  payment_url: 'https://pay.example/501',
  amount_kopeks: 35000,
  amount_rubles: 350,
  status: 'pending',
  expires_at: null,
  intent_status: 'accepted',
  price_kopeks: 45000,
  ...over,
});
function inline(over: Partial<DeviceFirstOptions> = {}) {
  return renderConfigurator({
    options: { ...options, topup_intent_enabled: true, ...over },
    initialPath: oplReturn,
  });
}
const pick = (card = false) =>
  screen.findByRole('button', { name: new RegExp(`deviceFirst.pay${card ? 'Card' : 'Sbp'}:`) });
async function tap(card = false) {
  fireEvent.click(await pick(card));
  await waitFor(() => expect(createTopUp).toHaveBeenCalled());
}

describe('ОПЛ-1 single summary payment protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    getBalancePaymentMethods.mockResolvedValue(flowMethods);
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [
        { key: 'cards_ru', provider_code: 11 },
        { key: 'sbp', provider_code: 2 },
        { key: 'crypto', provider_code: 13 },
      ],
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      topup_intent_enabled: true,
    });
    createTopUp.mockResolvedValue(oplAnswer());
    useSuccessNotification.setState({ closeOthersSignal: 0, isOpen: false, data: null });
  });
  afterEach(() => {
    cleanup();
    /* @ts-expect-error test override */ delete document.visibilityState;
  });
  it('opening summary creates no invoice; cash methods sorted SBP first, crypto absent', async () => {
    inline();
    await pick();
    expect(createTopUp).not.toHaveBeenCalled();
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => /deviceFirst.pay(Sbp|Card):/.test(b.textContent ?? ''));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'deviceFirst.paySbp:350 ₽',
      'deviceFirst.payCard:350 ₽',
    ]);
    expect(screen.queryByRole('button', { name: /deviceFirst.crypto/ })).toBeNull();
  });
  it.each([false, true])(
    'tap method card=%s sends exact amount and change_method and opens bank once',
    async (card) => {
      inline();
      await tap(card);
      await waitFor(() => expect(openLink).toHaveBeenCalledTimes(1));
      expect(createTopUp).toHaveBeenCalledWith(35000, 'platega', card ? '11' : '2', {
        period_days: 30,
        devices: 2,
        change_method: true,
      });
      expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
    },
  );
  it('pending memory precedes bank opener and carries exact return target', async () => {
    let pendingAtOpen: ReturnType<typeof loadTopUpPendingInfo> = null;
    openLink.mockImplementationOnce(() => {
      pendingAtOpen = loadTopUpPendingInfo();
    });
    inline();
    await tap();
    await waitFor(() => expect(openLink).toHaveBeenCalled());
    expect(pendingAtOpen).toMatchObject({
      payment_id: '501',
      amount_kopeks: 35000,
      return_to: oplReturn,
    });
  });
  it.each([{ amount_kopeks: 36000 }, { price_kopeks: 46000 }])(
    'amount OR price mismatch %j never opens or stores; refreshes receipt',
    async (over) => {
      createTopUp.mockResolvedValue(oplAnswer(over));
      inline();
      await tap();
      await screen.findByText('deviceFirst.refreshTitle');
      expect(openLink).not.toHaveBeenCalled();
      expect(loadTopUpPendingInfo()).toBeNull();
      expect(deviceFirstApi.getOptions).toHaveBeenCalled();
    },
  );
  it('synchronous double tap produces one POST, both methods disabled while pending', async () => {
    let resolve!: (v: ReturnType<typeof oplAnswer>) => void;
    createTopUp.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    inline();
    const button = await pick();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(createTopUp).toHaveBeenCalledTimes(1);
    expect((await pick(true)) as HTMLButtonElement).toHaveProperty('disabled', true);
    await act(async () => resolve(oplAnswer()));
  });
  it('full-price alternative is disabled during top-up request', async () => {
    createTopUp.mockImplementation(() => new Promise(() => {}));
    inline();
    await tap();
    fireEvent.click(screen.getByText('deviceFirst.payFullPrice'));
    for (const button of screen.getAllByRole('button', {
      name: /deviceFirst.paymentMethodAmount:/,
    }))
      expect(button).toHaveProperty('disabled', true);
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
  });
  it('late response after unmount does not store or open bank', async () => {
    let resolve!: (v: ReturnType<typeof oplAnswer>) => void;
    createTopUp.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = inline();
    await tap();
    view.unmount();
    await act(async () => resolve(oplAnswer()));
    expect(openLink).not.toHaveBeenCalled();
    expect(loadTopUpPendingInfo()).toBeNull();
  });
  it('visible without opening bank does not navigate', async () => {
    inline();
    await pick();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('location').textContent).not.toContain('/result');
  });
  it('hidden after opening bank does not navigate, visible returns to result', async () => {
    inline();
    await tap();
    await waitFor(() => expect(openLink).toHaveBeenCalled());
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('location').textContent).not.toContain('/result');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('location').textContent).toContain(
      '/balance/top-up/result?returnTo=',
    );
  });
  it('socket success after invoice leads to result; no second invoice', async () => {
    inline();
    await tap();
    await waitFor(() => expect(openLink).toHaveBeenCalled());
    act(() =>
      useSuccessNotification.getState().show({ type: 'balance_topup', amountKopeks: 35000 }),
    );
    expect(screen.getByTestId('location').textContent).toContain('/balance/top-up/result');
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });
  it('desktop explicit paid link leads to result even without visibility change', async () => {
    inline();
    await tap();
    fireEvent.click(await screen.findByRole('button', { name: 'balance.topUpOrder.paidAlready' }));
    expect(screen.getByTestId('location').textContent).toContain('/balance/top-up/result');
  });
  it('already_paid stores payment and leads to result, never bank or recent purchase question', async () => {
    createTopUp.mockResolvedValue(oplAnswer({ intent_status: 'already_paid' }));
    inline();
    await tap();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('/balance/top-up/result'),
    );
    expect(loadTopUpPendingInfo()?.payment_id).toBe('501');
    expect(openLink).not.toHaveBeenCalled();
    expect(screen.queryByText('balance.topUpOrder.morePeriodYes')).toBeNull();
  });
  it.each(['accepted', 'already_paying'])(
    '%s keeps same-payment method repeat and allows explicit method switch',
    async (intent_status) => {
      createTopUp.mockResolvedValue(oplAnswer({ intent_status }));
      inline();
      await tap();
      await waitFor(() => expect(openLink).toHaveBeenCalledTimes(1));
      await tap();
      await waitFor(() => expect(openLink).toHaveBeenCalledTimes(2));
      expect(createTopUp.mock.calls[1][2]).toBe('2');
      await tap(true);
      await waitFor(() => expect(openLink).toHaveBeenCalledTimes(3));
      expect(createTopUp.mock.calls[2]).toEqual([
        35000,
        'platega',
        '11',
        { period_days: 30, devices: 2, change_method: true },
      ]);
      expect(screen.queryByText('balance.topUpOrder.oldInvoiceVoid')).toBeNull();
    },
  );
  it('already_fulfilled asks own question; Yes preserves timestamp, method and change_method', async () => {
    createTopUp
      .mockResolvedValueOnce(
        oplAnswer({
          intent_status: 'already_fulfilled',
          purchased_at: paidAt,
          subscription_end_date: '2027-01-01T00:00:00Z',
        }),
      )
      .mockResolvedValue(oplAnswer());
    inline();
    await tap(true);
    fireEvent.click(
      await screen.findByRole('button', { name: 'balance.topUpOrder.morePeriodYes' }),
    );
    await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(2));
    expect(createTopUp.mock.calls[1][3]).toEqual({
      period_days: 30,
      devices: 2,
      change_method: true,
      confirmed_purchase_at: paidAt,
    });
    expect(createTopUp.mock.calls[1][2]).toBe('11');
    expect(loadConfirmedPurchase(30, 2)).toBe(paidAt);
    await waitFor(() => expect(openLink).toHaveBeenCalledTimes(1));
    cleanup();
    inline();
    await tap(true);
    expect(createTopUp.mock.calls[2][3]).toHaveProperty('confirmed_purchase_at', paidAt);
  });
  it('confirmed purchase reload is configuration scoped', async () => {
    saveConfirmedPurchase(30, 2, paidAt);
    inline();
    await tap();
    expect(createTopUp.mock.calls[0][3]).toHaveProperty('confirmed_purchase_at', paidAt);
  });
  it('confirmation for another configuration is not sent', async () => {
    saveConfirmedPurchase(90, 3, paidAt);
    inline();
    await tap();
    expect(createTopUp.mock.calls[0][3]).not.toHaveProperty('confirmed_purchase_at');
  });
  it('No after fulfilled goes home without another invoice', async () => {
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'already_fulfilled', purchased_at: paidAt }),
    );
    inline();
    await tap();
    fireEvent.click(await screen.findByRole('button', { name: 'balance.topUpOrder.morePeriodNo' }));
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(createTopUp).toHaveBeenCalledTimes(1);
    expect(openLink).not.toHaveBeenCalled();
  });
  it('rejected same confirmation does not ask same question endlessly', async () => {
    saveConfirmedPurchase(30, 2, paidAt);
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'already_fulfilled', purchased_at: paidAt }),
    );
    inline();
    await tap();
    await screen.findByText('balance.topUpOrder.confirmRejected');
    expect(screen.queryByText('balance.topUpOrder.morePeriodYes')).toBeNull();
    expect(openLink).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'restricted', 'account_erasure', 'method_not_supported'])(
    'ordinary/%s never stores or opens; alternative revealed; support narrowly scoped',
    async (reason) => {
      createTopUp.mockResolvedValue(
        oplAnswer({ intent_status: 'ordinary', intent_reason: reason }),
      );
      inline();
      await tap();
      await waitFor(() =>
        expect(screen.getByText('deviceFirst.payFullPrice').closest('details')?.open).toBe(true),
      );
      expect(openLink).not.toHaveBeenCalled();
      expect(loadTopUpPendingInfo()).toBeNull();
      if (!['restricted', 'account_erasure'].includes(reason)) {
        expect(screen.getByText('balance.topUpResult.intent.reasons.unavailable')).toBeTruthy();
        expect(screen.queryByText('deviceFirst.unavailable')).toBeNull();
      }
      expect(!!screen.queryByRole('button', { name: 'balance.topUpOrder.writeSupport' })).toBe(
        ['restricted', 'account_erasure'].includes(reason),
      );
    },
  );
  it('open_order follows exact public checkout ID without bank', async () => {
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'open_order', checkout_public_id: 'CO-99' }),
    );
    inline();
    await tap();
    fireEvent.click(await screen.findByRole('button', { name: 'balance.topUpOrder.toMyOrder' }));
    expect(screen.getByTestId('location').textContent).toContain('checkout=CO-99');
    expect(openLink).not.toHaveBeenCalled();
  });
  it('order_on_review offers support without bank', async () => {
    createTopUp.mockResolvedValue(oplAnswer({ intent_status: 'order_on_review' }));
    inline();
    await tap();
    fireEvent.click(await screen.findByRole('button', { name: 'balance.topUpOrder.writeSupport' }));
    expect(screen.getByTestId('location').textContent).toBe('/support');
    expect(openLink).not.toHaveBeenCalled();
  });
  it.each(['invoice_not_created', 'missing_url', 'network'])(
    '%s offers error and method retry without stale memory',
    async (status) => {
      if (status === 'network') createTopUp.mockRejectedValueOnce(new Error('secret server error'));
      else
        createTopUp.mockResolvedValueOnce(
          oplAnswer(status === 'missing_url' ? { payment_url: null } : { intent_status: status }),
        );
      inline();
      await tap();
      await screen.findByRole('alert');
      expect(openLink).not.toHaveBeenCalled();
      expect(loadTopUpPendingInfo()).toBeNull();
      await tap(true);
      await waitFor(() => expect(openLink).toHaveBeenCalledTimes(1));
      expect(createTopUp).toHaveBeenCalledTimes(2);
    },
  );
  it('balance covers refresh leads to wallet CTA, no bank', async () => {
    createTopUp.mockResolvedValue(oplAnswer({ intent_status: 'balance_covers' }));
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      balance_kopeks: 45000,
      topup_intent_enabled: true,
    });
    inline();
    await tap();
    await screen.findByRole('button', { name: /deviceFirst.payAndOrder:/ });
    expect(openLink).not.toHaveBeenCalled();
  });
  it('flag OFF retains old top-up action, no inline POST', async () => {
    inline({ topup_intent_enabled: false });
    await screen.findByRole('button', { name: 'deviceFirst.payExternalAndOrder:350 ₽' });
    expect(screen.queryByRole('button', { name: /deviceFirst.paySbp:/ })).toBeNull();
    expect(createTopUp).not.toHaveBeenCalled();
  });
  it('empty cash list offers noMethods, never silently posts crypto', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'crypto', provider_code: 13 }],
    });
    inline();
    await screen.findByText('deviceFirst.noMethods');
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /deviceFirst.paySbp:/ })).toBeNull();
  });

  it('one available card sends11 without silently substituting SBP', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'cards_ru', provider_code: 11 }],
    });
    inline();
    await tap(true);
    expect(createTopUp.mock.calls[0][2]).toBe('11');
    expect(screen.queryByRole('button', { name: /deviceFirst.paySbp:/ })).toBeNull();
  });
  it('a removed card is no longer offered; explicit SBP selection sends2', async () => {
    const view = inline();
    await pick(true);
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'sbp', provider_code: 2 }],
    });
    await act(async () => {
      await view.queryClient.refetchQueries({ queryKey: ['device-first-payment-methods'] });
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /deviceFirst.payCard:/ })).toBeNull(),
    );
    await tap();
    expect(createTopUp.mock.calls[0][2]).toBe('2');
  });
  it('a newer purchase after prior Yes asks again about that newer timestamp', async () => {
    saveConfirmedPurchase(30, 2, paidAt);
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'already_fulfilled', purchased_at: '2026-10-19T13:00:00Z' }),
    );
    inline();
    await tap();
    await screen.findByRole('button', { name: 'balance.topUpOrder.morePeriodYes' });
    expect(screen.queryByText('balance.topUpOrder.confirmRejected')).toBeNull();
    expect(openLink).not.toHaveBeenCalled();
  });
  it('fulfilled response without purchased_at has No and no unsupported Yes', async () => {
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'already_fulfilled', purchased_at: null }),
    );
    inline();
    await tap();
    await screen.findByRole('button', { name: 'balance.topUpOrder.morePeriodNo' });
    expect(screen.queryByRole('button', { name: 'balance.topUpOrder.morePeriodYes' })).toBeNull();
    expect(openLink).not.toHaveBeenCalled();
  });
  it('socket success without payment number stays on summary', async () => {
    inline();
    await pick();
    act(() => useSuccessNotification.getState().show({ type: 'balance_topup' }));
    expect(screen.getByTestId('location').textContent).not.toContain('/result');
    expect(createTopUp).not.toHaveBeenCalled();
  });
  it('code12 is a card, SBP2 remains first', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [
        { key: 'cards_int', provider_code: 12 },
        { key: 'sbp', provider_code: 2 },
      ],
    });
    inline();
    await tap(true);
    expect(createTopUp.mock.calls[0][2]).toBe('12');
  });
  it('Change clears ordinary outcome before confirming new selection', async () => {
    createTopUp.mockResolvedValue(
      oplAnswer({ intent_status: 'ordinary', intent_reason: 'unavailable' }),
    );
    inline();
    await tap();
    await screen.findByText('balance.topUpResult.intent.reasons.unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.review' }));
    await pick();
    expect(screen.queryByText('balance.topUpResult.intent.reasons.unavailable')).toBeNull();
  });
  it('plain full-price alternative immediately opens bank after selection', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://pay.example/direct',
    });
    inline();
    await pick();
    fireEvent.click(screen.getByText('deviceFirst.payFullPrice'));
    fireEvent.click(screen.getAllByRole('button', { name: /deviceFirst.paymentMethodAmount:/ })[0]);
    await waitFor(() => expect(openLink).toHaveBeenCalledWith('https://pay.example/direct'));
    expect(createTopUp).not.toHaveBeenCalled();
  });
});

let w2SetOptions: (v: DeviceFirstOptions) => void;
function W2Host() {
  const [currentOptions, setCurrentOptions] = useState<DeviceFirstOptions>({
    ...options,
    topup_intent_enabled: true,
  });
  useEffect(() => {
    w2SetOptions = setCurrentOptions;
  }, []);
  return <DeviceFirstConfigurator options={currentOptions} />;
}
function w2Mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[oplReturn]}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <W2Host />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
describe('W2 adversarial probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    getBalancePaymentMethods.mockResolvedValue(flowMethods);
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [
        { key: 'sbp', provider_code: 2 },
        { key: 'cards_ru', provider_code: 11 },
      ],
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.payDirect).mockImplementation(() => new Promise(() => {}));
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      topup_intent_enabled: true,
    });
    createTopUp.mockResolvedValue(oplAnswer());
    useSuccessNotification.setState({ closeOthersSignal: 0, isOpen: false, data: null });
  });
  afterEach(cleanup);
  it('W2 wallet action cannot overlap in-flight top-up after balance props update', async () => {
    createTopUp.mockImplementation(() => new Promise(() => {}));
    w2Mount();
    await tap();
    act(() => w2SetOptions({ ...options, balance_kopeks: 45000, topup_intent_enabled: true }));
    const wallet = await screen.findByRole('button', { name: /deviceFirst.payAndOrder:/ });
    fireEvent.click(wallet);
    await act(async () => {});
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
  });
  it('W2 alternate and top-up share a synchronous lock before React flush', async () => {
    createTopUp.mockImplementation(() => new Promise(() => {}));
    inline();
    const topup = await pick();
    fireEvent.click(screen.getByText('deviceFirst.payFullPrice'));
    const alternate = screen.getAllByRole('button', {
      name: /deviceFirst.paymentMethodAmount:/,
    })[0];
    act(() => {
      fireEvent.click(topup);
      fireEvent.click(alternate);
    });
    await act(async () => {});
    expect(
      createTopUp.mock.calls.length + vi.mocked(deviceFirstApi.payDirect).mock.calls.length,
    ).toBe(1);
  });
  it('W2 late network rejection cannot attach error to a changed confirmation', async () => {
    let reject!: (e: Error) => void;
    createTopUp.mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    inline();
    await tap();
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.review' }));
    await act(async () => reject(new Error('late old request')));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([0, 10000])(
    'W2 only crypto noMethods fallback has no loop at balance=%s',
    async (balance) => {
      vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
        methods: [{ key: 'crypto', provider_code: 13 }],
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      render(
        <MemoryRouter initialEntries={[oplReturn]}>
          <QueryClientProvider client={client}>
            <LocationProbe />
            <Routes>
              <Route
                path="/subscription/purchase"
                element={
                  <DeviceFirstConfigurator
                    options={{ ...options, balance_kopeks: balance, topup_intent_enabled: true }}
                  />
                }
              />
              <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.needTopup' }));
      await screen.findByRole('spinbutton');
      const target = new URL(screen.getByTestId('location').textContent!, 'https://test.local');
      expect(target.pathname).toBe('/balance/top-up/platega');
      expect(target.searchParams.has('amount')).toBe(false);
      expect(createTopUp).not.toHaveBeenCalled();
    },
  );
  it('W2 freshBalance snapshot yields to later options balance update', async () => {
    createTopUp.mockResolvedValue(oplAnswer({ intent_status: 'balance_covers' }));
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      balance_kopeks: 45000,
      topup_intent_enabled: true,
    });
    w2Mount();
    await tap();
    await screen.findByRole('button', { name: /deviceFirst.payAndOrder:/ });
    act(() => w2SetOptions({ ...options, balance_kopeks: 20000, topup_intent_enabled: true }));
    expect((await pick()).textContent).toBe('deviceFirst.paySbp:250 ₽');
    expect(openLink).not.toHaveBeenCalled();
  });
  it('W2 late success cannot open old bank after Change and Review', async () => {
    let resolve!: (v: ReturnType<typeof oplAnswer>) => void;
    createTopUp.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    inline();
    await tap();
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.review' }));
    await act(async () => resolve(oplAnswer()));
    expect(openLink).not.toHaveBeenCalled();
    expect(loadTopUpPendingInfo()).toBeNull();
  });
});
