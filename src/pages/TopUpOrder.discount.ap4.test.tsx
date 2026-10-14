// @vitest-environment jsdom

import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import type { PaymentMethod, TopUpResponse } from '@/types';
import { RATE_LIMIT_KEYS, resetRateLimit } from '@/utils/rateLimit';
import TopUpOrder from './TopUpOrder';

const { createTopUp, getActiveDiscount, openLink } = vi.hoisted(() => ({
  createTopUp: vi.fn(),
  getActiveDiscount: vi.fn(),
  openLink: vi.fn(),
}));
vi.mock('@/api/balance', () => ({ balanceApi: { createTopUp } }));
vi.mock('@/api/promo', () => ({ promoApi: { getActiveDiscount } }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink, openTelegramLink: vi.fn(), haptic: { impact: vi.fn() } }),
}));
vi.mock('@/store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
// The invoice is denominated in RUB even when the user's general display currency is USD.
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), currencySymbol: '$' }),
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

const method = {
  id: 'platega',
  name: 'Platega',
  is_available: true,
  min_amount_kopeks: 10000,
  options: [
    { id: '2', name: 'СБП' },
    { id: '11', name: 'Карта' },
  ],
} as PaymentMethod;
const applied = {
  discount_percent: 10,
  source: 'trial_discount',
  expires_at: '2026-10-14T22:30:00Z',
};
function answer(over: Partial<TopUpResponse> = {}): TopUpResponse {
  return {
    payment_id: 'invoice-own-347',
    payment_url: 'https://example.test/invoice-own-347',
    amount_kopeks: 8400,
    amount_rubles: 84,
    price_kopeks: 13400,
    status: 'pending',
    expires_at: null,
    intent_status: 'accepted',
    payment_option: '2',
    period_days: 30,
    devices: 2,
    ...over,
  };
}
function mount() {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <TopUpOrder
          method={method}
          initialOptionId="2"
          tariffName="Premium"
          periodDays={30}
          devices={2}
          amountKopeks={8400}
          checkoutReturn="/subscription/purchase?period=30&devices=2"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
function receipt(container: HTMLElement) {
  return [...container.querySelectorAll('dl > div')].map((row) => ({
    label: row.querySelector('dt')?.textContent ?? '',
    value: row.querySelector('dd')?.textContent ?? '',
  }));
}
function valueFor(rows: ReturnType<typeof receipt>, label: RegExp) {
  return rows.find((row) => label.test(row.label))?.value;
}
function displayedRubles(value: string) {
  return Number(value.replace(/\s|₽/g, '').replace('−', '-').replace(',', '.'));
}
async function loaded(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('dl')).not.toBeNull());
  return receipt(container);
}
beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
  await language.changeLanguage('ru');
  getActiveDiscount
    .mockReset()
    .mockResolvedValue({ ...applied, discount_percent: 30, is_active: true });
  createTopUp.mockReset().mockResolvedValue(answer());
});
afterEach(cleanup);

describe('AP-4 TopUp invoice-owned discount receipt', () => {
  it.each(['accepted', 'already_paying'])(
    'reads %s snapshot A without borrowing active offer B',
    async (status) => {
      createTopUp.mockResolvedValue(
        answer({ intent_status: status, promo_offer: applied, promo_offer_discount_kopeks: 1500 }),
      );
      const { container } = mount();
      const rows = await loaded(container);
      expect(valueFor(rows, /^Цена$/)).toBe('149 ₽');
      expect(valueFor(rows, /^Скидка/)).toBe('−15 ₽');
      expect(valueFor(rows, /^С вашего баланса$/)).toBe('−50 ₽');
      expect(valueFor(rows, /^К оплате$/)).toBe('84 ₽');
      expect(container.textContent).not.toContain('30%');
      expect(getActiveDiscount).not.toHaveBeenCalled();
      expect(createTopUp).toHaveBeenCalledWith(8400, 'platega', '2', {
        period_days: 30,
        devices: 2,
      });
    },
  );

  it('uses the applied share of balance when the provider minimum leaves 16 RUB untouched', async () => {
    createTopUp.mockResolvedValue(
      answer({
        amount_kopeks: 10000,
        amount_rubles: 100,
        promo_offer: applied,
        promo_offer_discount_kopeks: 1500,
      }),
    );
    const { container } = mount();
    const rows = await loaded(container);
    expect(rows.map((row) => row.value)).toEqual(['149 ₽', '−15 ₽', '−34 ₽', '100 ₽']);
  });

  it('never prints a negative wallet debit when the provider minimum exceeds the net price', async () => {
    createTopUp.mockResolvedValue(
      answer({
        amount_kopeks: 20000,
        amount_rubles: 200,
        promo_offer: applied,
        promo_offer_discount_kopeks: 1500,
      }),
    );
    const { container } = mount();
    const rows = await loaded(container);
    expect(rows.map((row) => row.value)).toEqual(['149 ₽', '−15 ₽', '+66 ₽', '200 ₽']);
    expect(valueFor(rows, /^С вашего баланса$/)).toBeUndefined();
    expect(valueFor(rows, /^Останется на балансе$/)).toBe('+66 ₽');
    expect(valueFor(rows, /^К оплате$/)).toBe('200 ₽');
    expect(rows.slice(0, -1).reduce((sum, row) => sum + displayedRubles(row.value), 0)).toBe(
      displayedRubles(rows.at(-1)!.value),
    );
    expect(container.textContent).not.toMatch(/−-66|−−66/);
    fireEvent.click(screen.getByRole('button', { name: 'Оплатить 200 ₽' }));
    expect(openLink).toHaveBeenCalledWith('https://example.test/invoice-own-347');
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it.each(['ru', 'en'])(
    'an old API invoice over net has an honest positive-credit receipt and exact payable in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      createTopUp.mockResolvedValue(answer({ amount_kopeks: 20000, amount_rubles: 200 }));
      const { container } = mount();
      const rows = await loaded(container);
      expect(rows.map((row) => row.value)).toEqual(['134 ₽', '+66 ₽', '200 ₽']);
      expect(
        valueFor(rows, locale === 'ru' ? /^Останется на балансе$/ : /^Left on your balance$/),
      ).toBe('+66 ₽');
      expect(valueFor(rows, /^Скидка|^Discount/)).toBeUndefined();
      expect(valueFor(rows, /^С вашего баланса$|^From your balance$/)).toBeUndefined();
      expect(rows.slice(0, -1).reduce((sum, row) => sum + displayedRubles(row.value), 0)).toBe(
        displayedRubles(rows.at(-1)!.value),
      );
      fireEvent.click(
        screen.getByRole('button', { name: locale === 'ru' ? 'Оплатить 200 ₽' : 'Pay 200 ₽' }),
      );
      expect(openLink).toHaveBeenCalledWith('https://example.test/invoice-own-347');
      expect(getActiveDiscount).not.toHaveBeenCalled();
      expect(createTopUp).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, null])(
    'keeps the old invoice receipt when its snapshot is %s',
    async (snapshot) => {
      createTopUp.mockResolvedValue(answer({ promo_offer: snapshot }));
      const { container } = mount();
      const rows = await loaded(container);
      expect(valueFor(rows, /^Цена$/)).toBe('134 ₽');
      expect(valueFor(rows, /^Скидка/)).toBeUndefined();
      expect(valueFor(rows, /^С вашего баланса$/)).toBe('−50 ₽');
      expect(getActiveDiscount).not.toHaveBeenCalled();
    },
  );

  it.each([-1500, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'falls back calmly for invalid personal amount %s',
    async (personal) => {
      createTopUp.mockResolvedValue(
        answer({ promo_offer: applied, promo_offer_discount_kopeks: personal }),
      );
      const { container } = mount();
      const rows = await loaded(container);
      expect(valueFor(rows, /^Цена$/)).toBe('134 ₽');
      expect(valueFor(rows, /^Скидка/)).toBeUndefined();
      expect(valueFor(rows, /^К оплате$/)).toBe('84 ₽');
      expect(container.textContent).not.toMatch(/NaN|Infinity/);
    },
  );

  it('retains exact kopeks, RUB and the same payment request in real English', async () => {
    await language.changeLanguage('en');
    createTopUp.mockResolvedValue(
      answer({
        price_kopeks: 13450,
        amount_kopeks: 8450,
        amount_rubles: 84.5,
        promo_offer_discount_kopeks: 1505,
      }),
    );
    const { container } = mount();
    const rows = await loaded(container);
    expect(valueFor(rows, /^Price$/)).toBe('149,55 ₽');
    expect(valueFor(rows, /^Discount/)).toBe('−15,05 ₽');
    expect(valueFor(rows, /^From your balance$/)).toBe('−50 ₽');
    expect(valueFor(rows, /^To pay$/)).toBe('84,50 ₽');
    expect(container.textContent).not.toContain('$');
  });

  it('method change and retry preserve the original intent contract and own receipt', async () => {
    const own = answer({ promo_offer: applied, promo_offer_discount_kopeks: 1500 });
    createTopUp
      .mockResolvedValueOnce(own)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(own);
    const { container } = mount();
    await loaded(container);
    fireEvent.click(screen.getByRole('button', { name: 'Карта' }));
    fireEvent.click(await screen.findByRole('button', { name: language.t('common.retry') }));
    await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(3));
    expect(createTopUp.mock.calls[1]).toEqual([
      8400,
      'platega',
      '11',
      { period_days: 30, devices: 2, change_method: true },
    ]);
    expect(createTopUp.mock.calls[2]).toEqual(createTopUp.mock.calls[1]);
    expect(valueFor(await loaded(container), /^Цена$/)).toBe('149 ₽');
  });

  it.each(['ru', 'en'])(
    'already-fulfilled date uses Moscow at UTC midnight boundary in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      createTopUp.mockResolvedValue(
        answer({
          intent_status: 'already_fulfilled',
          payment_url: null,
          subscription_end_date: '2026-10-14T22:30:00Z',
          purchased_at: '2026-10-14T12:00:00Z',
        }),
      );
      const { container } = mount();
      await screen.findByText(locale === 'ru' ? /Подписка.*до/ : /subscription is active until/);
      expect(container.textContent).toMatch(
        locale === 'ru' ? /15 октября 2026.*\(МСК\)/ : /15\.10\.2026.*\(MSK\)/,
      );
      expect(container.textContent).not.toContain('14 октября');
    },
  );
});
