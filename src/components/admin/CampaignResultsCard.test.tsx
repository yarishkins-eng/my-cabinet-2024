// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import type { TopCampaignsResponse } from '../../api/admin';
import en from '../../locales/en.json';
import fa from '../../locales/fa.json';
import ru from '../../locales/ru.json';
import zh from '../../locales/zh.json';

import { CampaignResultsCard } from './CampaignResultsCard';

const data: TopCampaignsResponse = {
  total_campaigns: 3,
  total_registrations: 114,
  total_revenue_kopeks: 0,
  total_leads: 114,
  total_paying_leads: 5,
  payment_conversion_rate: 4.4,
  confirmed_receipts_kopeks: 228_500,
  campaigns: [
    {
      id: 4,
      name: 'Кувалда 7000₽',
      start_parameter: 'teplo2',
      bonus_type: 'none',
      is_active: true,
      registrations: 107,
      conversions: 4,
      conversion_rate: 3.7,
      total_revenue_kopeks: 0,
      avg_revenue_per_user_kopeks: 0,
      leads: 107,
      paying_leads: 4,
      payment_conversion_rate: 3.7,
      confirmed_receipts_kopeks: 203_600,
      avg_confirmed_receipts_per_lead_kopeks: 1902,
    },
    {
      id: 3,
      name: 'Киношная 4500',
      start_parameter: 'teplovpn1',
      bonus_type: 'none',
      is_active: true,
      registrations: 7,
      conversions: 1,
      conversion_rate: 14.3,
      total_revenue_kopeks: 0,
      avg_revenue_per_user_kopeks: 0,
      leads: 7,
      paying_leads: 1,
      payment_conversion_rate: 14.3,
      confirmed_receipts_kopeks: 24_900,
      avg_confirmed_receipts_per_lead_kopeks: 3557,
    },
  ],
};

async function renderCard(cardData: TopCampaignsResponse, language = 'ru') {
  const instance = createInstance();
  await instance.init({
    lng: language,
    fallbackLng: 'ru',
    resources: {
      ru: { translation: ru },
      en: { translation: en },
      fa: { translation: fa },
      zh: { translation: zh },
    },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={instance}>
      <CampaignResultsCard
        data={cardData}
        currencySymbol="₽"
        formatAmount={(rubles) => rubles.toFixed(2)}
      />
    </I18nextProvider>,
  );
}

describe('CampaignResultsCard', () => {
  afterEach(cleanup);

  it('renders the audited receipt totals and payment conversion instead of legacy zero revenue', async () => {
    await renderCard(data);

    expect(screen.getByText('Результаты рекламных кампаний')).toBeTruthy();
    expect(screen.getByText('3 РК · 114 лидов · 5 оплатили · 4,4%')).toBeTruthy();
    expect(screen.getByText('2036.00 ₽')).toBeTruthy();
    expect(screen.getByText('4 оплатили · 3,7%')).toBeTruthy();
    expect(screen.getByText('249.00 ₽')).toBeTruthy();
    expect(screen.getByText('1 оплатил · 14,3%')).toBeTruthy();
    expect(screen.getByText('2285.00 ₽')).toBeTruthy();
    expect(screen.queryByText('0.00 ₽')).toBeNull();
    expect(screen.getByText(/обычные возвраты пока не вычитаются/)).toBeTruthy();
  });

  it('uses real Persian plural resources for zero and never falls back to Russian', async () => {
    await renderCard(
      {
        ...data,
        total_campaigns: 1,
        total_leads: 0,
        total_paying_leads: 0,
        payment_conversion_rate: 0,
        confirmed_receipts_kopeks: 0,
        campaigns: [],
      },
      'fa',
    );

    expect(screen.getByText(/1 کمپین/)).toBeTruthy();
    expect(screen.getByText(/0 سرنخ/)).toBeTruthy();
    expect(screen.getByText(/0 پرداخت کرده/)).toBeTruthy();
    expect(screen.queryByText(/лид|оплатил/)).toBeNull();
  });

  it('resolves the Chinese campaign summary without a fallback language', async () => {
    await renderCard(
      {
        ...data,
        total_campaigns: 1,
        total_leads: 0,
        total_paying_leads: 0,
        payment_conversion_rate: 0,
        confirmed_receipts_kopeks: 0,
        campaigns: [],
      },
      'zh',
    );

    expect(screen.getByText(/1 个活动/)).toBeTruthy();
    expect(screen.getByText(/0 个潜在客户/)).toBeTruthy();
    expect(screen.getByText(/0 人已付款/)).toBeTruthy();
    expect(screen.queryByText(/лид|оплатил|campaign|paid/)).toBeNull();
  });

  it('keeps a legacy API response finite during a coordinated rollback', async () => {
    const legacy = {
      total_campaigns: 1,
      total_registrations: 7,
      total_revenue_kopeks: 0,
      campaigns: [
        {
          id: 3,
          name: 'Legacy API',
          start_parameter: 'legacy',
          bonus_type: 'none',
          is_active: true,
          registrations: 7,
          conversions: 1,
          conversion_rate: 14.3,
          total_revenue_kopeks: 0,
          avg_revenue_per_user_kopeks: 0,
        },
      ],
    } as TopCampaignsResponse;

    await renderCard(legacy, 'en');

    expect(screen.getByText(/1 campaign · 7 leads · 1 paid · 14.3%/)).toBeTruthy();
    expect(screen.getByText('1 paid · 14.3%')).toBeTruthy();
    expect(document.body.textContent).not.toContain('NaN');
  });
});
