// @vitest-environment jsdom

import { createInstance } from 'i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import PromoDiscountBanner from './PromoDiscountBanner';

const { getActiveDiscount, getOffers } = vi.hoisted(() => ({
  getActiveDiscount: vi.fn(),
  getOffers: vi.fn(),
}));
vi.mock('@/api/promo', () => ({ promoApi: { getActiveDiscount, getOffers, claimOffer: vi.fn() } }));
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
const originalTimeZone = process.env.TZ;

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PromoDiscountBanner />
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  await language.changeLanguage('ru');
  process.env.TZ = 'America/Los_Angeles';
  getOffers.mockReset().mockResolvedValue([]);
  getActiveDiscount.mockReset().mockResolvedValue({
    discount_percent: 17,
    source: 'trial_discount',
    expires_at: '2026-10-14T22:30:00Z',
    is_active: true,
  });
});
afterEach(() => {
  cleanup();
  process.env.TZ = originalTimeZone;
});

describe('AP-4 actual promo banner deadlines in Moscow', () => {
  it.each(['ru', 'en'])(
    'active offer names Moscow midnight rollover in real %s copy',
    async (locale) => {
      await language.changeLanguage(locale);
      const { container } = mount();
      await screen.findByText(language.t('promo.offers.discountActiveTitle', { percent: 17 }));
      expect(container.textContent).toMatch(locale === 'ru' ? /15\.10.*01:30/ : /10\/15.*01:30/);
      expect(container.textContent).toContain(locale === 'ru' ? '(МСК)' : '(MSK)');
      expect(container.textContent).not.toContain(locale === 'ru' ? '14.10' : '10/14');
    },
  );

  it.each(['ru', 'en'])(
    'unclaimed offer uses the same explicit Moscow deadline in %s',
    async (locale) => {
      await language.changeLanguage(locale);
      getActiveDiscount.mockResolvedValue({
        discount_percent: 0,
        source: null,
        expires_at: null,
        is_active: false,
      });
      getOffers.mockResolvedValue([
        {
          id: 777,
          notification_type: 'trial_ending_discount',
          discount_percent: 17,
          effect_type: 'percent_discount',
          expires_at: '2026-10-14T22:30:00Z',
          is_active: true,
          is_claimed: false,
          claimed_at: null,
          extra_data: null,
        },
      ]);
      const { container } = mount();
      await screen.findByRole('button', { name: locale === 'ru' ? 'Активировать' : 'Activate' });
      expect(container.textContent).toMatch(locale === 'ru' ? /15\.10.*01:30/ : /10\/15.*01:30/);
      expect(container.textContent).toContain(locale === 'ru' ? '(МСК)' : '(MSK)');
    },
  );

  it.each([null, 'bad-deadline'])('does not print Invalid Date for %s', async (deadline) => {
    getActiveDiscount.mockResolvedValue({
      discount_percent: 17,
      source: 'trial_discount',
      expires_at: deadline,
      is_active: true,
    });
    const { container } = mount();
    await screen.findByText(/Скидка 17% активна/);
    expect(container.textContent).not.toContain('Invalid Date');
    expect(container.textContent).not.toContain('Истекает:');
  });
});
