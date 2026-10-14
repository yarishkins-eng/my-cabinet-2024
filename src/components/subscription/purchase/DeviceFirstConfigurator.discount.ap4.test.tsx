// @vitest-environment jsdom

import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
const { getActiveDiscount, getPaymentMethods } = vi.hoisted(() => ({
  getActiveDiscount: vi.fn(),
  getPaymentMethods: vi.fn(),
}));
vi.mock('@/api/promo', () => ({ promoApi: { getActiveDiscount } }));
vi.mock('@/api/balance', () => ({ balanceApi: { getPaymentMethods } }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink: vi.fn(), haptic: { impact: vi.fn() } }),
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
function mount(
  ownOptions = options(),
  row?: DeviceFirstCheckout,
  seed?: (client: QueryClient) => void,
  initialPath = '/subscription/purchase',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(client);
  const tree = (current: DeviceFirstOptions) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={client}>
        <DeviceFirstConfigurator
          options={current}
          fixtureCheckout={row}
          fixtureMethods={[
            { key: 'sbp', provider_code: 2 },
            { key: 'cards_ru', provider_code: 11 },
          ]}
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
    fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
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
      expect(rowValue(/^К оплате$/)).toBe(
        wallet === 0 ? '134 ₽' : wallet === 5000 ? '84 ₽' : '0 ₽',
      );
      if (wallet) expect(rowValue(/^С вашего баланса$/)).toBe(wallet === 5000 ? '−50 ₽' : '−134 ₽');
      if (wallet === 5000) {
        expect(screen.getByText(ru.deviceFirst.walletReceiptNotice)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
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
    expect(screen.getByText('Your subscription starts immediately after payment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /SBP.*134 ₽/ }));
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
      const caption = screen.getByText(
        locale === 'ru' ? ru.deviceFirst.walletReceiptNotice : en.deviceFirst.walletReceiptNotice,
      );
      expect(rowValue(locale === 'ru' ? /^С вашего баланса$/ : /^From your balance$/)).toBe(
        '−50 ₽',
      );
      expect(rowValue(locale === 'ru' ? /^К оплате$/ : /^To pay$/)).toBe('84 ₽');
      const direct = screen.getByRole('button', {
        name: locale === 'ru' ? /СБП.*134 ₽/ : /SBP.*134 ₽/,
      });
      expect(
        caption.compareDocumentPosition(direct) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
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
    const card = await screen.findByRole('button', { name: /Карта российского банка.*134 ₽/ });
    const caption = screen.getByText(ru.deviceFirst.walletReceiptNotice);
    expect(caption.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rowValue(/^К оплате$/)).toBe('84 ₽');
    expect(vi.mocked(deviceFirstApi.payDirect)).not.toHaveBeenCalled();
    expect(vi.mocked(deviceFirstApi.nativeLaunchDirect)).not.toHaveBeenCalled();
    expect(card.className).toContain('bg-accent-500');
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
    expect(rowValue(/^С вашего баланса$/)).toBe('−50 ₽');
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
        locale === 'ru' ? '15 окт. 2026 (МСК)' : 'Oct 15, 2026 (MSK)',
      );
      unmount();
      const ready = mount(
        options(),
        checkout({ ui_state: 'ready', current_subscription_is_trial: false }),
      ).container;
      expect(ready.textContent).toContain(
        locale === 'ru' ? '15 окт. 2026 (МСК)' : 'Oct 15, 2026 (MSK)',
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
      const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {});
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`СБП.*${expected / 100} ₽`) }));
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['device-first-options'] }),
      );
      expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
      expect(screen.queryByText(/Скидка закончилась, пока вы выбирали/)).toBeNull();
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
    const { client } = mount(options());
    await screen.findByText(/Скидка 10% уже/);
    await review();
    fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    await screen.findByText(/^Скидка$/);
    expect(rowValue(/^Скидка$/)).toBe('−15 ₽');
    await settle();
    clock.mockReturnValue(deadline + 1000);
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['device-first-options'] }),
    );
    expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
    expect(screen.queryByText(/Скидка закончилась, пока вы выбирали/)).toBeNull();
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
    const { client } = mount(options());
    await screen.findByText(/Скидка 10% уже/);
    await review();
    clock.mockReturnValue(deadline + 1000);
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['device-first-options'] }),
    );
    expect(screen.getByText(/Скидка закончилась, пока вы выбирали/)).toBeTruthy();
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
      const { client, updateOptions } = mount(options({ promo_offer: snapshot }));
      await review();
      const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
        updateOptions(
          options({
            promo_offer: null,
            price_matrix: [{ period_days: 30, prices: [cell(2, 14900, 0)] }],
          }),
        );
      });
      fireEvent.click(screen.getByRole('button', { name: /СБП.*134 ₽/ }));
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['device-first-options'] }),
      );
      const expiryCopy = screen.queryByText(/Скидка закончилась, пока вы выбирали/);
      expect(expiryCopy !== null).toBe(special);
      if (!special) expect(screen.getByText(ru.deviceFirst.refreshText)).toBeTruthy();
      expect(screen.getByText('1 мес.')).toBeTruthy();
      expect(
        vi.mocked(deviceFirstApi.payDirect).mock.calls[0][0].expected_tariff_total_kopeks,
      ).toBe(13400);
      fireEvent.click(await screen.findByRole('button', { name: /СБП.*149 ₽/ }));
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
    const { client, updateOptions } = mount(chosen);
    let groups = screen.getAllByRole('radiogroup');
    fireEvent.click(within(groups[0]).getAllByRole('radio')[1]);
    groups = screen.getAllByRole('radiogroup');
    fireEvent.click(within(groups[1]).getAllByRole('radio')[1]);
    await review();
    vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
      updateOptions({
        ...chosen,
        promo_offer: null,
        price_matrix: [
          chosen.price_matrix![0],
          { period_days: 90, prices: [cell(2, 44500, 0), cell(5, 58900, 0)] },
        ],
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /СБП.*530 ₽/ }));
    fireEvent.click(await screen.findByRole('button', { name: /СБП.*589 ₽/ }));
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
