// @vitest-environment jsdom

import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
  type DeviceFirstPrice,
} from '@/api/deviceFirst';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';

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
const { getActiveDiscount, getPaymentMethods, openLink } = vi.hoisted(() => ({
  getActiveDiscount: vi.fn(),
  getPaymentMethods: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock('@/api/promo', () => ({ promoApi: { getActiveDiscount } }));
vi.mock('@/api/balance', () => ({ balanceApi: { getPaymentMethods } }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink, haptic: { impact: vi.fn() } }),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), currencySymbol: '₽' }),
}));
const language = createInstance();
void language.init({
  lng: 'ru',
  resources: { ru: { translation: ru }, en: { translation: en } },
  initImmediate: false,
  interpolation: { escapeValue: false },
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: language.t.bind(language), i18n: language }),
}));

const applied = {
  discount_percent: 10,
  source: 'trial_discount',
  expires_at: '2026-10-14T22:30:00Z',
};
function cell(devices = 2, net = 13400, personal = 1500, group = 0): DeviceFirstPrice {
  return {
    device_limit: devices,
    price_kopeks: net,
    breakdown: {
      base_price_kopeks: net + personal,
      devices_price_kopeks: 0,
      promo_group_discount_kopeks: group,
      promo_offer_discount_kopeks: personal,
    },
  };
}
function options(over: Partial<DeviceFirstOptions> = {}): DeviceFirstOptions {
  return {
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
    balance_kopeks: 0,
    price_matrix: [{ period_days: 30, prices: [cell()] }],
    ...over,
  };
}
function checkout(over: Partial<DeviceFirstCheckout> = {}): DeviceFirstCheckout {
  return {
    id: 'own-discount-checkout',
    tariff_id: 7,
    target_subscription_id: null,
    period_days: 30,
    selected_device_limit: 2,
    price_breakdown: cell().breakdown,
    quoted_price_kopeks: 13400,
    max_price_kopeks: 13400,
    settlement_mode: 'direct_purchase_v2',
    tariff_total_kopeks: 13400,
    wallet_applied_kopeks: 0,
    external_payable_kopeks: 13400,
    funding_mode: 'platega',
    lifecycle_state: 'confirmation',
    funding_state: 'not_started',
    provisioning_state: 'not_started',
    terminal_reason: null,
    ui_state: 'confirmation',
    created_subscription_id: null,
    current_device_limit: null,
    current_subscription_is_trial: null,
    estimated_end_at: '2026-10-14T22:30:00Z',
    expires_at: '2026-10-14T22:30:00Z',
    balance_kopeks: 5000,
    shortage_kopeks: 8400,
    top_up_surplus_kopeks: 0,
    ...over,
  };
}
function LocationProbe() {
  const route = useLocation();
  return <output data-testid="checkout-location">{route.pathname + route.search}</output>;
}
function directButton(rubles: number, method = 'sbp') {
  const disclosure = screen.queryByText(language.t('deviceFirst.payFullPrice'));
  if (disclosure) {
    if (!(disclosure.closest('details') as HTMLDetailsElement).open) fireEvent.click(disclosure);
  } else {
    const primary = screen.queryByRole('button', {
      name: language.t('deviceFirst.payExternalAndOrder', { amount: `${rubles} ₽` }),
    });
    if (primary) fireEvent.click(primary);
  }
  return screen.getByRole('button', {
    name: new RegExp(
      `${method === 'sbp' ? (language.language === 'ru' ? 'СБП' : 'SBP') : language.t('deviceFirst.cards')}.*${rubles} ₽`,
    ),
  });
}
function mount(
  ownOptions = options(),
  row?: DeviceFirstCheckout,
  seed?: (client: QueryClient) => void,
  initialPath = '/subscription/purchase',
  fixtureMethods = [
    { key: 'sbp', provider_code: 2 },
    { key: 'cards_ru', provider_code: 11 },
  ],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(client);
  const tree = (current: DeviceFirstOptions) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <DeviceFirstConfigurator
          options={current}
          fixtureCheckout={row}
          fixtureMethods={fixtureMethods}
        />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(tree(ownOptions));
  return {
    ...rendered,
    client,
    updateOptions: (next: DeviceFirstOptions) => rendered.rerender(tree(next)),
  };
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function review() {
  fireEvent.click(screen.getByRole('button', { name: language.t('deviceFirst.review') }));
  await settle();
}
function rowValue(label: string | RegExp) {
  const text = screen.getByText(label);
  return text.parentElement?.querySelector('strong')?.textContent;
}
function strikes(container: HTMLElement) {
  return [...container.querySelectorAll('s, del, .line-through')].map((node) => node.textContent);
}
beforeEach(async () => {
  vi.resetAllMocks();
  sessionStorage.clear();
  await language.changeLanguage('ru');
  vi.mocked(deviceFirstApi.getOptions).mockResolvedValue(options());
  getActiveDiscount.mockResolvedValue({ ...applied, is_active: true });
  getPaymentMethods.mockResolvedValue([
    { id: 'platega', is_available: true, min_amount_kopeks: 10000 },
  ]);
  vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
    methods: [{ key: 'sbp', provider_code: 2 }],
  });
  vi.mocked(deviceFirstApi.payDirect).mockReturnValue(new Promise(() => {}));
  vi.mocked(deviceFirstApi.nativeLaunchDirect).mockReturnValue(new Promise(() => {}));
  vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
    redirect_url: 'https://example.test/own',
    status: 'pending',
    resume_allowed: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AP-4 real local checkout discount selection', () => {
  it('old trial-discount API immediately shows exact strike and keeps the raw price token', async () => {
    const { container } = mount();
    await screen.findByText(/Скидка 10% уже/);
    expect(container.textContent).toContain('(МСК)');
    expect(container.textContent).toMatch(/15\.10.*01:30/);
    const groups = screen.getAllByRole('radiogroup');
    expect(strikes(groups[0])).toEqual(['149 ₽']);
    expect(strikes(groups[1])).toEqual(['149 ₽']);
    expect(groups[0].textContent).toContain('134 ₽');
    expect(groups[1].textContent).toContain('134 ₽');
    await review();
    expect(rowValue(/^Цена$/)).toBe('149 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
    fireEvent.click(directButton(134));
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
    expect(deviceFirstApi.payDirect).toHaveBeenCalledWith({
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'platega',
      method_key: 'sbp',
      expected_tariff_total_kopeks: 13400,
    });
  });

  it('every period/device strike comes from its own group-adjusted cell, including prorate', async () => {
    const multi = options({
      period_options: [30, 90],
      device_options: [2, 5],
      promo_offer: applied,
      price_matrix: [
        {
          period_days: 30,
          prices: [
            cell(2, 12700, 1455, 745),
            {
              ...cell(5, 26000, 2911, 0),
              breakdown: {
                ...cell(5, 26000, 2911).breakdown,
                base_price_kopeks: 24800,
                devices_price_kopeks: 4111,
                upgrade_prorate_kopeks: 4111,
                upgrade_remaining_days: 17,
              },
            },
          ],
        },
        { period_days: 90, prices: [cell(2, 40000, 4500), cell(5, 53000, 5900)] },
      ],
    });
    mount(multi);
    await settle();
    let groups = screen.getAllByRole('radiogroup');
    expect(strikes(groups[0])).toEqual(['141,55 ₽', '445 ₽']);
    expect(strikes(groups[1])).toEqual(['141,55 ₽', '289,11 ₽']);
    fireEvent.click(within(groups[1]).getAllByRole('radio')[1]);
    groups = screen.getAllByRole('radiogroup');
    expect(strikes(groups[0])).toEqual(['289,11 ₽', '589 ₽']);
    await review();
    expect(rowValue(/^Цена$/)).toBe('289,11 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−29,11 ₽');
    expect(screen.getByText(/41,11 ₽.*17 дн/)).toBeTruthy();
  });

  it.each([0, 5000, 50000])(
    'receipt clamps wallet %s to the actual net and preserves the debit token',
    async (wallet) => {
      mount(options({ balance_kopeks: wallet, promo_offer: applied }));
      await review();
      expect(rowValue(/^Цена$/)).toBe('149 ₽');
      expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
      expect(rowValue(wallet === 50000 ? /^Спишем с баланса$/ : /^К оплате$/)).toBe(
        wallet === 0 ? '134 ₽' : wallet === 5000 ? '100 ₽' : '134 ₽',
      );
      if (wallet === 5000) expect(rowValue(/^С баланса$/)).toBe('−34 ₽');
      if (wallet === 50000) expect(screen.queryByText(/^К оплате$/)).toBeNull();
      if (wallet === 5000) {
        expect(screen.queryByText(ru.deviceFirst.walletReceiptNotice)).toBeNull();
        fireEvent.click(directButton(134));
        await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
        expect(deviceFirstApi.payDirect).toHaveBeenCalledWith({
          period_days: 30,
          selected_device_limit: 2,
          funding_mode: 'platega',
          method_key: 'sbp',
          expected_tariff_total_kopeks: 13400,
        });
      }
      if (wallet === 50000) {
        fireEvent.click(screen.getByRole('button', { name: 'Списать 134 ₽ и оформить' }));
        await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
        expect(deviceFirstApi.payDirect).toHaveBeenCalledWith({
          period_days: 30,
          selected_device_limit: 2,
          funding_mode: 'wallet',
          method_key: null,
          expected_tariff_total_kopeks: 13400,
        });
      }
    },
  );

  it('group-only pricing never shows a personal all-periods banner or personal strike', async () => {
    const { container } = mount(
      options({
        promo_offer: applied,
        price_matrix: [{ period_days: 30, prices: [cell(2, 14155, 0, 745)] }],
      }),
    );
    await settle();
    expect(container.textContent).not.toMatch(/Скидка 10% уже|любой срок/);
    expect(strikes(container)).toEqual([]);
    await review();
    expect(screen.queryByText(/^Скидка/)).toBeNull();
    expect(rowValue(/^К оплате$/)).toBe('141,55 ₽');
  });

  it.each(['explicit-null', 'mismatch', 'inactive', 'expired', 'invalid-deadline', 'failed-query'])(
    'legacy %s keeps exact money and never promises an inactive deadline in the banner',
    async (caseName) => {
      const own = options(caseName === 'explicit-null' ? { promo_offer: null } : {});
      if (caseName === 'mismatch')
        getActiveDiscount.mockResolvedValue({ ...applied, discount_percent: 30, is_active: true });
      if (caseName === 'inactive')
        getActiveDiscount.mockResolvedValue({ ...applied, is_active: false });
      if (caseName === 'expired')
        getActiveDiscount.mockResolvedValue({
          ...applied,
          expires_at: '2000-01-01T00:00:00Z',
          is_active: true,
        });
      if (caseName === 'invalid-deadline')
        getActiveDiscount.mockResolvedValue({
          ...applied,
          expires_at: 'nonsense',
          is_active: true,
        });
      if (caseName === 'failed-query') getActiveDiscount.mockRejectedValue(new Error('offline'));
      const { container } = mount(own);
      await settle();
      expect(container.textContent).not.toMatch(/Скидка 10% уже|Скидка 30% уже/);
      await review();
      expect(rowValue(/^Цена$/)).toBe('149 ₽');
      const receiptLabel =
        caseName === 'expired' || caseName === 'invalid-deadline' ? /^Скидка 10%$/ : /^Скидка$/;
      expect(rowValue(receiptLabel)).toBe('−15 ₽');
    },
  );

  it('legacy 31 percent is not silently capped at the future campaign ceiling', async () => {
    getActiveDiscount.mockResolvedValue({ ...applied, discount_percent: 31, is_active: true });
    mount(options({ price_matrix: [{ period_days: 30, prices: [cell(2, 10200, 4700)] }] }));
    await screen.findByText(/Скидка 31% уже/);
    await review();
    expect(rowValue(/^Скидка 31%$/)).toBe('−47 ₽');
  });

  it('future options snapshot A takes precedence over current B without needing is_active', async () => {
    getActiveDiscount.mockResolvedValue({
      ...applied,
      discount_percent: 30,
      expires_at: '2099-12-31T12:00:00Z',
      is_active: true,
    });
    const { container } = mount(options({ promo_offer: applied }));
    await screen.findByText(/Скидка 10% уже/);
    expect(container.textContent).not.toContain('30%');
    expect(container.textContent).toMatch(/15\.10.*01:30/);
  });

  it('real English displays personal savings and a canonical trial conversion without changing the raw token', async () => {
    await language.changeLanguage('en');
    const { container } = mount(
      options({
        promo_offer: applied,
        current_subscription: { id: 660, device_limit: 2, is_trial: true, tariff_id: 3 },
      }),
    );
    await screen.findByText(/10% off is already in the prices/);
    expect(container.textContent).toContain('(MSK)');
    await review();
    expect(rowValue(/^Price$/)).toBe('149 ₽');
    expect(rowValue(/^Discount 10%$/)).toBe('−15 ₽');
    expect(rowValue(/^To pay$/)).toBe('134 ₽');
    expect(screen.getByText('Your subscription starts immediately after payment')).toBeTruthy();
    fireEvent.click(directButton(134));
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0].expected_tariff_total_kopeks).toBe(
      13400,
    );
  });

  it.each(['ru', 'en'])(
    'a partial-wallet receipt explicitly names its path before a full-price direct action in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      mount(options({ balance_kopeks: 5000, promo_offer: applied }));
      await review();
      expect(
        screen.queryByText(
          locale === 'ru' ? ru.deviceFirst.walletReceiptNotice : en.deviceFirst.walletReceiptNotice,
        ),
      ).toBeNull();
      expect(rowValue(locale === 'ru' ? /^С баланса$/ : /^From balance$/)).toBe('−34 ₽');
      expect(rowValue(locale === 'ru' ? /^К оплате$/ : /^To pay$/)).toBe('100 ₽');
      expect(
        screen.getByRole('button', {
          name: language.t('deviceFirst.payExternalAndOrder', { amount: '100 ₽' }),
        }),
      ).toBeTruthy();
      const direct = directButton(134);
      fireEvent.click(direct);
      await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
      expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0]).toEqual({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'platega',
        method_key: 'sbp',
        expected_tariff_total_kopeks: 13400,
      });
    },
  );

  it('a held card selected in chat has the same explicit receipt caption and keeps raw direct price 13400', async () => {
    mount(
      options({ balance_kopeks: 5000, promo_offer: applied }),
      undefined,
      undefined,
      '/subscription/purchase?period=30&devices=2&method=cards_ru&autostart=1',
    );
    await screen.findByText(ru.deviceFirst.payFullPrice);
    const card = directButton(134, 'cards_ru');
    expect(screen.queryByText(ru.deviceFirst.walletReceiptNotice)).toBeNull();
    await waitFor(() => expect(rowValue(/^К оплате$/)).toBe('100 ₽'));
    expect(vi.mocked(deviceFirstApi.payDirect)).not.toHaveBeenCalled();
    expect(vi.mocked(deviceFirstApi.nativeLaunchDirect)).not.toHaveBeenCalled();
    fireEvent.click(card);
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0]).toEqual({
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'platega',
      method_key: 'cards_ru',
      expected_tariff_total_kopeks: 13400,
      purchase_context: 'chat_autostart',
      confirmed_purchase_id: null,
    });
  });
});

describe('AP-4 immutable checkout receipts and trial contract', () => {
  it.each([undefined, null])(
    'resumed confirmation with snapshot=%s does not borrow current B or options A',
    async (snapshot) => {
      getActiveDiscount.mockResolvedValue({
        ...applied,
        expires_at: '2099-12-31T12:00:00Z',
        is_active: true,
      });
      mount(
        options({ promo_offer: applied, balance_kopeks: 5000 }),
        checkout({ promo_offer: snapshot }),
        (client) =>
          client.setQueryData(['active-discount'], {
            ...applied,
            source: 'different-current-source',
            expires_at: '2099-12-31T12:00:00Z',
            is_active: true,
          }),
      );
      await settle();
      expect(rowValue(/^Цена$/)).toBe('149 ₽');
      expect(rowValue(/^Скидка$/)).toBe('−15 ₽');
      expect(screen.queryByText(/^Скидка 10%$/)).toBeNull();
      expect(screen.queryByText(/^Скидка 30%$/)).toBeNull();
    },
  );

  it('frozen direct invoice uses its own discount and funding fields while current wallet/quote differ', async () => {
    mount(
      options({ promo_offer: { ...applied, discount_percent: 30 }, balance_kopeks: 999999 }),
      checkout({
        ui_state: 'awaiting_payment',
        funding_state: 'invoice_pending',
        promo_offer: applied,
        wallet_applied_kopeks: 0,
        external_payable_kopeks: 13400,
      }),
    );
    await settle();
    expect(rowValue(/^Цена$/)).toBe('149 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
    expect(rowValue(/^К оплате$/)).toBe('134 ₽');
    expect(screen.queryByText(/^С вашего баланса$/)).toBeNull();
  });

  it('a frozen snapshot keeps the historical nominal percent after expiry and its own exact wallet share', async () => {
    mount(
      options({ balance_kopeks: 999999, promo_offer: { ...applied, discount_percent: 30 } }),
      checkout({
        ui_state: 'awaiting_payment',
        promo_offer: { ...applied, expires_at: '2000-01-01T00:00:00Z' },
        wallet_applied_kopeks: 5000,
        external_payable_kopeks: 8400,
      }),
    );
    await settle();
    expect(rowValue(/^Цена$/)).toBe('149 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
    expect(rowValue(/^С баланса$/)).toBe('−50 ₽');
    expect(rowValue(/^К оплате$/)).toBe('84 ₽');
  });

  it.each(['ru', 'en'])(
    'the provider invoice deadline names Moscow rather than the phone timezone in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      const { client } = mount(
        options(),
        checkout({
          ui_state: 'awaiting_payment',
          provider_invoice_expires_at: '2026-10-14T22:30:00Z',
        }),
      );
      await act(async () => {
        client.setQueryData(['device-first-pending-payment', 'own-discount-checkout'], {
          redirect_url: 'https://example.test/own',
          status: 'pending',
          resume_allowed: false,
        });
      });
      const deadlineCopy = (await screen.findByText(/Счёт действует до|invoice is valid until/i))
        .textContent;
      expect(deadlineCopy).toMatch(/0?1:30/);
      expect(deadlineCopy).toContain(locale === 'ru' ? '(МСК)' : '(MSK)');
    },
  );

  it.each(['ru', 'en'])(
    'frozen summary and renewal-ready dates use Moscow once in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      const { container, unmount } = mount(
        options(),
        checkout({ ui_state: 'awaiting_payment', current_subscription_is_trial: false }),
      );
      await settle();
      expect(container.textContent).toContain(
        locale === 'ru' ? '15 окт. 2026 (МСК)' : '15.10.2026 (MSK)',
      );
      unmount();
      const ready = mount(
        options(),
        checkout({ ui_state: 'ready', current_subscription_is_trial: false }),
      ).container;
      expect(ready.textContent).toContain(
        locale === 'ru' ? '15 окт. 2026 (МСК)' : '15.10.2026 (MSK)',
      );
      expect(ready.textContent).not.toMatch(/\(МСК\).*\(МСК\)|\(MSK\).*\(MSK\)/);
    },
  );

  it.each([
    [true, 3, true],
    [true, 7, false],
    [true, undefined, false],
    [false, 3, false],
  ])(
    'local trial=%s old tariff=%s only canonical conversion promises start-now=%s',
    async (trial, oldTariff, promised) => {
      mount(
        options({
          current_subscription: { id: 660, device_limit: 2, is_trial: trial, tariff_id: oldTariff },
        }),
      );
      await review();
      expect(screen.queryByText(/^Подписка начнётся сразу после оплаты\.?$/) !== null).toBe(
        promised,
      );
    },
  );

  it('resumed trial with unknown original tariff cannot promise loss of remaining trial time', async () => {
    mount(
      options({ current_subscription: { id: 660, device_limit: 2, is_trial: true, tariff_id: 3 } }),
      checkout({ current_subscription_is_trial: true }),
    );
    await settle();
    expect(screen.queryByText(/^Подписка начнётся сразу после оплаты\.?$/)).toBeNull();
  });
});

describe('AP-4 reprice reason and refreshed payment token', () => {
  it.each(['explicit-null', 'mismatched-offer', 'new-price', 'replaced-current-offer'])(
    'a verified A deadline cannot leak into generic reprice after %s',
    async (change) => {
      const deadline = Date.parse(applied.expires_at);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 60000);
      vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce({
        response: { status: 409, data: { detail: { code: 'reprice_required' } } },
      });
      const { client, updateOptions } = mount(options());
      await screen.findByText(/Скидка 10% уже/);
      await review();
      let expected = 13400;
      if (change === 'explicit-null') updateOptions(options({ promo_offer: null }));
      if (change === 'mismatched-offer')
        updateOptions(options({ promo_offer: { ...applied, discount_percent: 30 } }));
      if (change === 'new-price') {
        expected = 14000;
        updateOptions(
          options({ price_matrix: [{ period_days: 30, prices: [cell(2, 14000, 1500)] }] }),
        );
      }
      if (change === 'replaced-current-offer')
        await act(async () => {
          client.setQueryData(['active-discount'], {
            ...applied,
            source: 'new-current-B',
            expires_at: '2099-12-31T12:00:00Z',
            is_active: true,
          });
        });
      await settle();
      clock.mockReturnValue(deadline + 1000);
      fireEvent.click(directButton(expected / 100));
      await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
      expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
      expect(screen.queryByText(/Скидка закончилась — деньги не списаны/)).toBeNull();
      expect(
        vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0].expected_tariff_total_kopeks,
      ).toBe(expected);
    },
  );

  it('verified local A cannot supply a deadline to a new server-owned resumed quote without its own snapshot', async () => {
    const deadline = Date.parse(applied.expires_at);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 60000);
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(
      checkout({ id: 'new-owned-quote', promo_offer: undefined }),
    );
    vi.mocked(deviceFirstApi.payDirect)
      .mockRejectedValueOnce({
        response: { status: 409, data: { detail: { code: 'invalid_state' } } },
      })
      .mockRejectedValueOnce({
        response: { status: 409, data: { detail: { code: 'reprice_required' } } },
      });
    mount(options());
    await screen.findByText(/Скидка 10% уже/);
    await review();
    fireEvent.click(directButton(134));
    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    await screen.findByText(/^Скидка$/);
    expect(rowValue(/^Скидка$/)).toBe('−15 ₽');
    await settle();
    clock.mockReturnValue(deadline + 1000);
    fireEvent.click(directButton(134));
    await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
    expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
    expect(screen.queryByText(/Скидка закончилась — деньги не списаны/)).toBeNull();
    expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[1][0].expected_tariff_total_kopeks).toBe(
      13400,
    );
  });

  it('a verified legacy deadline that passes while choosing is observed independently of a generic reprice cause', async () => {
    const deadline = Date.parse(applied.expires_at);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline - 60000);
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce({
      response: { status: 409, data: { detail: { code: 'reprice_required' } } },
    });
    mount(options());
    await screen.findByText(/Скидка 10% уже/);
    await review();
    clock.mockReturnValue(deadline + 1000);
    fireEvent.click(directButton(134));
    await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Скидка закончилась — деньги не списаны/)).toBeTruthy();
    expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0].expected_tariff_total_kopeks).toBe(
      13400,
    );
  });

  it.each([
    ['explicit-discount-reason', 'promo_offer_expired', undefined, true],
    ['known-applied-expiry', undefined, { ...applied, expires_at: '2000-01-01T00:00:00Z' }, true],
    ['generic-price-change', undefined, applied, false],
    ['quote-TTL', 'quote_expired', applied, false],
    [
      'explicit-quote-TTL-over-expired-own-offer',
      'quote_expired',
      { ...applied, expires_at: '2000-01-01T00:00:00Z' },
      false,
    ],
    ['unknown-deadline', undefined, { ...applied, expires_at: null }, false],
    ['invalid-deadline', undefined, { ...applied, expires_at: 'invalid' }, false],
  ])(
    '%s keeps the selection, invalidates options and uses fresh raw price',
    async (_name, reason, snapshot, special) => {
      vi.mocked(deviceFirstApi.payDirect)
        .mockRejectedValueOnce({
          response: {
            status: 409,
            data: { detail: { code: 'reprice_required', ...(reason ? { reason } : {}) } },
          },
        })
        .mockReturnValue(new Promise(() => {}));
      const { updateOptions } = mount(options({ promo_offer: snapshot }));
      await review();
      const refreshed = options({
        promo_offer: null,
        price_matrix: [{ period_days: 30, prices: [cell(2, 14900, 0)] }],
      });
      vi.mocked(deviceFirstApi.getOptions).mockImplementation(async () => {
        updateOptions(refreshed);
        return refreshed;
      });
      fireEvent.click(directButton(134));
      await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
      const expiryCopy = screen.queryByText(/Скидка закончилась — деньги не списаны/);
      expect(expiryCopy !== null).toBe(special);
      if (!special) expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
      expect(screen.getByText('1 мес.')).toBeTruthy();
      expect(
        vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0].expected_tariff_total_kopeks,
      ).toBe(13400);
      fireEvent.click(directButton(149));
      await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
      expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[1][0]).toEqual({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'platega',
        method_key: 'sbp',
        expected_tariff_total_kopeks: 14900,
      });
    },
  );

  it('a reprice preserves a chosen 90-day/5-device pair rather than resetting to defaults', async () => {
    vi.mocked(deviceFirstApi.payDirect)
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: { detail: { code: 'reprice_required', reason: 'promo_offer_expired' } },
        },
      })
      .mockReturnValue(new Promise(() => {}));
    const chosen = options({
      period_options: [30, 90],
      device_options: [2, 5],
      promo_offer: applied,
      price_matrix: [
        { period_days: 30, prices: [cell(), cell(5, 26000, 2911)] },
        { period_days: 90, prices: [cell(2, 40000, 4500), cell(5, 53000, 5900)] },
      ],
    });
    const { updateOptions } = mount(chosen);
    let groups = screen.getAllByRole('radiogroup');
    fireEvent.click(within(groups[0]).getAllByRole('radio')[1]);
    groups = screen.getAllByRole('radiogroup');
    fireEvent.click(within(groups[1]).getAllByRole('radio')[1]);
    await review();
    vi.mocked(deviceFirstApi.getOptions).mockImplementation(async () => {
      const refreshed = {
        ...chosen,
        promo_offer: null,
        price_matrix: [
          chosen.price_matrix![0],
          { period_days: 90, prices: [cell(2, 44500, 0), cell(5, 58900, 0)] },
        ],
      };
      updateOptions(refreshed);
      return refreshed;
    });
    fireEvent.click(directButton(530));
    await screen.findByRole('button', { name: /СБП.*589 ₽/ });
    fireEvent.click(directButton(589));
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
    expect(vi.mocked(deviceFirstApi.payDirect).mock.calls[1][0]).toEqual({
      period_days: 90,
      selected_device_limit: 5,
      funding_mode: 'platega',
      method_key: 'sbp',
      expected_tariff_total_kopeks: 58900,
    });
  });
});

describe('Owner compact checkout and surviving MX2/MX4 guards', () => {
  it('MX2: cents in the wallet do not make the receipt disagree with the rounded invoice', async () => {
    mount(options({ balance_kopeks: 1490, topup_intent_enabled: true, promo_offer: applied }));
    await review();
    expect(rowValue(/^Цена$/)).toBe('149 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
    expect(rowValue(/^С баланса$/)).toBe('−14 ₽');
    expect(rowValue(/^К оплате$/)).toBe('120 ₽');
    expect(screen.getByText('Остаток 0,90 ₽ останется на балансе')).toBeTruthy();
    expect(screen.queryByText(/^Баланс$/)).toBeNull();
    expect(screen.queryByText(/^Не хватает$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Оплатить 120 ₽' }));
    const target = new URL(
      screen.getByTestId('checkout-location').textContent!,
      'https://local.test',
    );
    expect(target.pathname).toBe('/balance/top-up/platega');
    expect(target.searchParams.get('amount')).toBe('120');
    const returned = new URL(target.searchParams.get('returnTo')!, 'https://local.test');
    expect(returned.searchParams.get('period')).toBe('30');
    expect(returned.searchParams.get('devices')).toBe('2');
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
  });

  it.each([-1, 0, 1])('MX4: banner deadline boundary now−deadline=%s ms', async (offset) => {
    const deadline = Date.parse(applied.expires_at);
    vi.spyOn(Date, 'now').mockReturnValue(deadline + offset);
    mount(options({ promo_offer: applied }));
    await settle();
    expect(screen.queryByText(/Скидка 10% уже в ценах/) !== null).toBe(offset < 0);
  });

  it('an offer without a deadline has no invented expiry wording or doubled separators', async () => {
    mount(options({ promo_offer: { ...applied, expires_at: null } }));
    const banner = await screen.findByText(/Скидка 10% уже в ценах/);
    expect(banner.textContent).toBe('🎁 Скидка 10% уже в ценах · любой срок и число устройств');
  });

  it('without discount or wallet the summary has only the total and immediate methods', async () => {
    mount(
      options({
        promo_offer: null,
        topup_intent_enabled: true,
        price_matrix: [{ period_days: 30, prices: [cell(2, 14900, 0)] }],
      }),
    );
    await review();
    expect(screen.getByRole('heading', { name: 'Premium · 2 устройства · 1 мес.' })).toBeTruthy();
    expect(screen.queryByText(/^Цена$/)).toBeNull();
    expect(screen.queryByText(/^Скидка/)).toBeNull();
    expect(screen.queryByText(/^С баланса$/)).toBeNull();
    expect(rowValue(/^К оплате$/)).toBe('149 ₽');
    expect(screen.getByRole('button', { name: 'СБП · 149 ₽' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Карта · 149 ₽' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Оплатить 149 ₽' })).toBeNull();
    expect(screen.getByText('Подписка оформится сама после оплаты')).toBeTruthy();
    expect(screen.queryByText(ru.deviceFirst.payFullPrice)).toBeNull();
    expect(screen.queryByText(ru.deviceFirst.whatIsIncluded)).toBeNull();
  });

  it('a visible card method creates the same monetary body and immediately opens the bank', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: checkout({ ui_state: 'awaiting_payment', funding_state: 'invoice_pending' }),
      redirect_url: 'https://example.test/owner-bank',
    });
    mount(options({ topup_intent_enabled: true, promo_offer: applied }));
    await review();
    const sbp = screen.getByRole('button', { name: 'СБП · 134 ₽' });
    const card = screen.getByRole('button', { name: 'Карта · 134 ₽' });
    expect(sbp.className).toContain('bg-accent-500');
    expect(card.classList.contains('bg-accent-500')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Оплатить 134 ₽' })).toBeNull();
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
    expect(openLink).not.toHaveBeenCalled();
    fireEvent.click(card);
    await waitFor(() =>
      expect(openLink).toHaveBeenCalledExactlyOnceWith('https://example.test/owner-bank'),
    );
    expect(deviceFirstApi.payDirect).toHaveBeenCalledExactlyOnceWith({
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'platega',
      method_key: 'cards_ru',
      expected_tariff_total_kopeks: 13400,
    });
  });

  it('legacy manual top-up does not promise immediate trial activation', async () => {
    mount(
      options({
        balance_kopeks: 5000,
        topup_intent_enabled: false,
        current_subscription: { id: 660, device_limit: 2, is_trial: true, tariff_id: 3 },
        promo_offer: applied,
      }),
    );
    await review();
    expect(screen.getByText(ru.deviceFirst.topUpShortageHint)).toBeTruthy();
    expect(screen.queryByText(ru.deviceFirst.trialStartsAfterPayment)).toBeNull();
    expect(screen.queryByText(ru.deviceFirst.topUpAutoHint)).toBeNull();
  });

  it('choosing crypto with a known positive amount still opens an automatic order', async () => {
    getPaymentMethods.mockResolvedValue([
      { id: 'platega', is_available: true, min_amount_kopeks: 100 },
    ]);
    mount(
      options({ balance_kopeks: 5000, topup_intent_enabled: true, promo_offer: applied }),
      undefined,
      undefined,
      '/subscription/purchase',
      [{ key: 'crypto', provider_code: 13 }],
    );
    await review();
    expect(screen.queryByText(ru.deviceFirst.topUpAutoHint)).toBeTruthy();
    expect(screen.queryByText(ru.deviceFirst.topUpShortageHint)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Оплатить 84 ₽' }));
    const href = screen.getByTestId('checkout-location').textContent!;
    const params = new URL(href, 'https://example.test').searchParams;
    expect(params.get('amount')).toBe('84');
    expect(params.get('chooseMethod')).toBe('1');
    expect(params.has('auto')).toBe(false);
    expect(params.get('returnTo')).toBe('/subscription/purchase?from=checkout&period=30&devices=2');
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
  });

  it('a minimum above net separates extra credit from the entire resulting wallet', async () => {
    getPaymentMethods.mockResolvedValue([
      { id: 'platega', is_available: true, min_amount_kopeks: 20000 },
    ]);
    mount(options({ balance_kopeks: 5000, topup_intent_enabled: true, promo_offer: applied }));
    await review();
    expect(rowValue(/^Цена$/)).toBe('149 ₽');
    expect(rowValue(/^Скидка 10%$/)).toBe('−15 ₽');
    expect(screen.queryByText(/^С баланса$/)).toBeNull();
    expect(rowValue(/^Сверх цены на баланс$/)).toBe('66 ₽');
    expect(rowValue(/^К оплате$/)).toBe('200 ₽');
    expect(screen.getByText('Остаток 116 ₽ останется на балансе')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Оплатить 200 ₽' })).toBeTruthy();
  });
});

it.each([undefined, {}])(
  'a resumed order without its own breakdown %s cannot borrow the current discount',
  async (breakdown) => {
    mount(
      options({ promo_offer: applied }),
      checkout({
        ui_state: 'confirmation',
        tariff_total_kopeks: 14900,
        quoted_price_kopeks: 14900,
        price_breakdown: breakdown as DeviceFirstCheckout['price_breakdown'],
      }),
    );
    await screen.findByText(/^К оплате$/);
    expect(screen.queryByText(/^Скидка/)).toBeNull();
    expect(rowValue(/^К оплате$/)).toBe('149 ₽');
    expect(screen.queryByText('164 ₽')).toBeNull();
  },
);

describe('Second owner decision: immediate methods and fresh prices', () => {
  const expired = {
    response: {
      status: 409,
      data: { detail: { code: 'reprice_required', reason: 'promo_offer_expired' } },
    },
  };
  const fresh = () =>
    options({
      promo_offer: null,
      price_matrix: [{ period_days: 30, prices: [cell(2, 14900, 0)] }],
    });

  it.each([0, 1, 50, 99])(
    'a %i kopeks wallet shows both direct methods and spends none of it',
    async (balance) => {
      vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
        checkout: checkout({ ui_state: 'awaiting_payment', funding_state: 'invoice_pending' }),
        redirect_url: 'https://example.test/immediate-sbp',
      });
      mount(options({ balance_kopeks: balance, promo_offer: applied, topup_intent_enabled: true }));
      await review();
      expect(rowValue(/^К оплате$/)).toBe('134 ₽');
      expect(screen.queryByText(/^С баланса$/)).toBeNull();
      expect(screen.queryByText(ru.deviceFirst.payFullPrice)).toBeNull();
      const sbp = screen.getByRole('button', { name: 'СБП · 134 ₽' });
      expect(screen.getByRole('button', { name: 'Карта · 134 ₽' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Оплатить 134 ₽' })).toBeNull();
      expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
      expect(openLink).not.toHaveBeenCalled();
      fireEvent.click(sbp);
      await waitFor(() =>
        expect(openLink).toHaveBeenCalledExactlyOnceWith('https://example.test/immediate-sbp'),
      );
      expect(deviceFirstApi.payDirect).toHaveBeenCalledExactlyOnceWith({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'platega',
        method_key: 'sbp',
        expected_tariff_total_kopeks: 13400,
      });
    },
  );

  it('99 kopeks stays direct even when rounding would make a noninteger quote cheaper to top up', async () => {
    mount(
      options({
        balance_kopeks: 99,
        topup_intent_enabled: true,
        price_matrix: [{ period_days: 30, prices: [cell(2, 13410, 0)] }],
      }),
    );
    await review();
    expect(rowValue(/^К оплате$/)).toBe('134,10 ₽');
    expect(screen.getByRole('button', { name: 'СБП · 134,10 ₽' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Карта · 134,10 ₽' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Оплатить 134 ₽' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'СБП · 134,10 ₽' }));
    await waitFor(() =>
      expect(deviceFirstApi.payDirect).toHaveBeenCalledExactlyOnceWith({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'platega',
        method_key: 'sbp',
        expected_tariff_total_kopeks: 13410,
      }),
    );
  });

  it('a full wallet hides the direct-payment link and retains the exact wallet retry after rejection', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce({
      response: { status: 422, data: { detail: { code: 'wallet_insufficient' } } },
    });
    mount(options({ balance_kopeks: 50000, promo_offer: applied, topup_intent_enabled: true }));
    await review();
    expect(rowValue(/^Спишем с баланса$/)).toBe('134 ₽');
    expect(screen.queryByText(/^К оплате$/)).toBeNull();
    expect(screen.queryByText(ru.deviceFirst.payFullPrice)).toBeNull();
    const retry = screen.getByRole('button', {
      name: language.t('deviceFirst.payAndOrder', { amount: '134 ₽' }),
    });
    fireEvent.click(retry);
    await screen.findByText(ru.deviceFirst.errorWalletInsufficient);
    expect(rowValue(/^Спишем с баланса$/)).toBe('134 ₽');
    expect(screen.queryByText(/^К оплате$/)).toBeNull();
    expect(screen.queryByText(ru.deviceFirst.payFullPrice)).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: language.t('deviceFirst.payAndOrder', { amount: '134 ₽' }),
      }),
    );
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
    for (const [payload] of vi.mocked(deviceFirstApi.payDirect).mock.calls) {
      expect(payload).toEqual({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'wallet',
        method_key: null,
        expected_tariff_total_kopeks: 13400,
      });
    }
    expect(openLink).not.toHaveBeenCalled();
  });

  it('an expired discount hides its old price and actions until the new GET resolves', async () => {
    let release!: (value: DeviceFirstOptions) => void;
    vi.mocked(deviceFirstApi.getOptions).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce(expired);
    mount(options({ promo_offer: applied }));
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'СБП · 134 ₽' }));
    await screen.findByText(ru.deviceFirst.pricesRefreshing);
    expect(screen.getByText(ru.deviceFirst.discountExpired)).toBeTruthy();
    expect(screen.queryByText('134 ₽')).toBeNull();
    expect(screen.queryByText(/^К оплате$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /СБП|Карта|Оплатить/ })).toBeNull();
    await act(async () => release(fresh()));
    await screen.findByRole('button', { name: 'СБП · 149 ₽' });
    expect(screen.getByRole('button', { name: 'Карта · 149 ₽' })).toBeTruthy();
    expect(screen.queryByText('134 ₽')).toBeNull();
    expect(screen.getByText('1 мес. · 2 устройства — 149 ₽')).toBeTruthy();
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'СБП · 149 ₽' }));
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
    expect(deviceFirstApi.payDirect).toHaveBeenLastCalledWith({
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'platega',
      method_key: 'sbp',
      expected_tariff_total_kopeks: 14900,
    });
  });

  it.each(['failed', 'malformed'] as const)(
    'a %s fresh matrix blocks payment and exposes a retry of the read GET only',
    async (cause) => {
      if (cause === 'failed')
        vi.mocked(deviceFirstApi.getOptions).mockRejectedValueOnce(new Error('offline'));
      else
        vi.mocked(deviceFirstApi.getOptions).mockResolvedValueOnce({
          ...fresh(),
          price_matrix: {},
        } as unknown as DeviceFirstOptions);
      vi.mocked(deviceFirstApi.getOptions).mockResolvedValue(fresh());
      vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce(expired);
      const prior = options({ promo_offer: applied });
      const { client } = mount(prior, undefined, (queryClient) =>
        queryClient.setQueryData(['device-first-options'], prior),
      );
      await review();
      fireEvent.click(screen.getByRole('button', { name: 'СБП · 134 ₽' }));
      const failure = await screen.findByRole('alert');
      expect(failure.textContent).toContain(ru.deviceFirst.pricesRefreshError);
      expect(screen.queryByText('134 ₽')).toBeNull();
      expect(screen.queryByText('149 ₽')).toBeNull();
      expect(screen.queryByRole('button', { name: /СБП|Карта|Оплатить/ })).toBeNull();
      expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(['device-first-options'])).toEqual(prior);
      expect(client.getQueryState(['device-first-options'])?.status).toBe('success');
      fireEvent.click(within(failure).getByRole('button', { name: ru.deviceFirst.retry }));
      await screen.findByRole('button', { name: 'СБП · 149 ₽' });
      expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(2);
      expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
      expect(openLink).not.toHaveBeenCalled();
    },
  );

  it('cancels an in-flight pre-expiry matrix query instead of deduplicating the fresh read into it', async () => {
    let staleRelease!: (value: DeviceFirstOptions) => void;
    const aborted = vi.fn();
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue(fresh());
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValueOnce(expired);
    const { client } = mount(options({ promo_offer: applied }), undefined, (queryClient) => {
      void queryClient
        .fetchQuery({
          queryKey: ['device-first-options'],
          queryFn: ({ signal }) => {
            signal.addEventListener('abort', aborted);
            return new Promise<DeviceFirstOptions>((resolve) => {
              staleRelease = resolve;
            });
          },
        })
        .catch(() => undefined);
    });
    await review();
    fireEvent.click(screen.getByRole('button', { name: 'СБП · 134 ₽' }));
    await screen.findByRole('button', { name: 'СБП · 149 ₽' });
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1);
    await act(async () => staleRelease(options()));
    expect(client.getQueryData<DeviceFirstOptions>(['device-first-options'])?.price_matrix).toEqual(
      fresh().price_matrix,
    );
    expect(screen.queryByRole('button', { name: 'СБП · 134 ₽' })).toBeNull();
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'failed'] as const)(
    'unknown top-up limits (%s) leave the numeric direct price and automatic activation hint visible',
    async (state) => {
      if (state === 'pending') getPaymentMethods.mockReturnValue(new Promise(() => {}));
      else getPaymentMethods.mockRejectedValue(new Error('limits offline'));
      mount(options({ balance_kopeks: 5000, topup_intent_enabled: true, promo_offer: applied }));
      await review();
      expect(rowValue(/^К оплате$/)).toBe('134 ₽');
      expect(screen.queryByText(/^С баланса$/)).toBeNull();
      expect(screen.getByRole('button', { name: 'СБП · 134 ₽' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Карта · 134 ₽' })).toBeTruthy();
      expect(screen.getByText(ru.deviceFirst.topUpAutoHint)).toBeTruthy();
      expect(screen.queryByText(ru.deviceFirst.topUpShortageHint)).toBeNull();
      expect(screen.queryByText(/^К оплате —$/)).toBeNull();
    },
  );

  it('a paid renewal with more devices names the old and new counts in its single-line heading', async () => {
    mount(
      options({
        promo_offer: null,
        device_options: [2, 3],
        current_subscription: { id: 660, device_limit: 2, is_trial: false, tariff_id: 7 },
        price_matrix: [{ period_days: 30, prices: [cell(2, 14900, 0), cell(3, 19900, 0)] }],
      }),
    );
    const devices = screen.getAllByRole('radiogroup')[1];
    fireEvent.click(within(devices).getAllByRole('radio')[1]);
    await review();
    expect(
      screen.getByRole('heading', { name: 'Premium · 2 → 3 устройства · 1 мес.' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'СБП · 199 ₽' }));
    await waitFor(() =>
      expect(deviceFirstApi.payDirect).toHaveBeenCalledExactlyOnceWith({
        period_days: 30,
        selected_device_limit: 3,
        funding_mode: 'platega',
        method_key: 'sbp',
        expected_tariff_total_kopeks: 19900,
      }),
    );
  });

  it.each([0, 14900])(
    'a frozen invoice with wallet share %i has the compact monetary receipt',
    async (walletShare) => {
      vi.mocked(deviceFirstApi.get).mockResolvedValue(
        checkout({
          ui_state: 'awaiting_payment',
          funding_state: 'invoice_pending',
          price_breakdown: cell(2, 14900, 0).breakdown,
          quoted_price_kopeks: 14900,
          tariff_total_kopeks: 14900,
          wallet_applied_kopeks: walletShare,
          external_payable_kopeks: 14900 - walletShare,
        }),
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <DeviceFirstConfigurator
              options={options()}
              initialCheckoutId="own-discount-checkout"
            />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      await screen.findByRole('dialog');
      expect(screen.queryByText(/^Цена$/)).toBeNull();
      expect(screen.queryByText(/^Баланс$/)).toBeNull();
      expect(screen.queryByText(/^Не хватает$/)).toBeNull();
      expect(screen.queryByText(/^С баланса$/)).toBeNull();
      if (walletShare) {
        expect(rowValue(/^Спишем с баланса$/)).toBe('149 ₽');
        expect(screen.queryByText(/^К оплате$/)).toBeNull();
      } else {
        expect(rowValue(/^К оплате$/)).toBe('149 ₽');
        expect(screen.queryByText(/^Спишем с баланса$/)).toBeNull();
      }
    },
  );
});
