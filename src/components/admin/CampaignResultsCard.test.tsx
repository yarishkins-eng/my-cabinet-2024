// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopCampaignsResponse } from '../../api/admin';
import { currencyApi } from '../../api/currency';
import { useCurrency } from '../../hooks/useCurrency';
import en from '../../locales/en.json';
import fa from '../../locales/fa.json';
import ru from '../../locales/ru.json';
import zh from '../../locales/zh.json';
import dashboardSource from '../../pages/AdminDashboard.tsx?raw';
import { usePermissionStore } from '../../store/permissions';

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
    {
      id: 2,
      name: 'моя москва 3000',
      start_parameter: 'teplo_vpn1',
      bonus_type: 'none',
      is_active: true,
      registrations: 0,
      conversions: 0,
      conversion_rate: 0,
      total_revenue_kopeks: 777,
      avg_revenue_per_user_kopeks: 0,
      leads: 0,
      paying_leads: 0,
      payment_conversion_rate: 0,
      confirmed_receipts_kopeks: 0,
      avg_confirmed_receipts_per_lead_kopeks: 0,
    },
  ],
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

async function renderCard(cardData: TopCampaignsResponse, language = 'ru', canOpenDetails = true) {
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
  document.documentElement.dir = instance.dir(language);
  return render(
    <I18nextProvider i18n={instance}>
      <MemoryRouter>
        <CampaignResultsCard
          data={cardData}
          currencySymbol="₽"
          formatAmount={(rubles) => rubles.toFixed(2)}
          canOpenDetails={canOpenDetails}
        />
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('CampaignResultsCard', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('dir');
    vi.restoreAllMocks();
  });

  it('renders the audited receipt totals and payment conversion instead of legacy zero revenue', async () => {
    await renderCard(data);

    expect(screen.getByText('Результаты рекламных кампаний')).toBeTruthy();
    expect(screen.getByText('3 РК · 114 лидов · 5 оплатили · 4,4%')).toBeTruthy();
    expect(screen.getByText('2036.00 ₽')).toBeTruthy();
    expect(screen.getByText('4 оплатили · 3,7%')).toBeTruthy();
    expect(screen.getByText('249.00 ₽')).toBeTruthy();
    expect(screen.getByText('1 оплатил · 14,3%')).toBeTruthy();
    expect(screen.getByText('моя москва 3000')).toBeTruthy();
    expect(screen.getByText('0.00 ₽')).toBeTruthy();
    expect(screen.getByText('89,1% от всех подтверждённых поступлений')).toBeTruthy();
    expect(screen.getByText('10,9% от всех подтверждённых поступлений')).toBeTruthy();
    expect(screen.getByText('0% от всех подтверждённых поступлений')).toBeTruthy();
    expect(screen.getByText('20.04 ₽')).toBeTruthy();
    expect(screen.getByText('457.00 ₽')).toBeTruthy();
    expect(screen.getByText('2285.00 ₽')).toBeTruthy();
    expect(screen.getByText(/обычные возвраты пока не вычитаются/)).toBeTruthy();
  });

  it('uses first-touch receipt fields, the all-campaign denominator, and discloses top five', async () => {
    const campaigns = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      name: `Campaign ${index + 1}`,
      start_parameter: `campaign_${index + 1}`,
      bonus_type: 'none',
      is_active: true,
      registrations: 100 + index,
      conversions: 40 + index,
      conversion_rate: 40,
      total_revenue_kopeks: 90_000,
      avg_revenue_per_user_kopeks: 900,
      leads: index === 0 ? 5 : 1,
      paying_leads: index === 0 ? 1 : 0,
      payment_conversion_rate: index === 0 ? 20 : 0,
      confirmed_receipts_kopeks: index === 0 ? 5_000 : index === 5 ? 1_000 : 0,
      avg_confirmed_receipts_per_lead_kopeks: 0,
    }));
    const adversarial: TopCampaignsResponse = {
      campaigns,
      total_campaigns: 6,
      total_registrations: 999,
      total_revenue_kopeks: 888_800,
      total_leads: 10,
      total_paying_leads: 2,
      payment_conversion_rate: 20,
      confirmed_receipts_kopeks: 10_000,
    };

    await renderCard(adversarial);

    expect(screen.getByText(/показаны топ-5 из 6/)).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByText('Campaign 6')).toBeNull();
    expect(screen.getByText('50% от всех подтверждённых поступлений')).toBeTruthy();
    expect(screen.getByText('1 оплатил · 20%')).toBeTruthy();
    expect(screen.getByText('10.00 ₽')).toBeTruthy();
    expect(screen.getByText('Поступлений на оплатившего').parentElement?.textContent).toContain(
      '50.00 ₽',
    );
    expect(screen.queryByText('8888.00 ₽')).toBeNull();
  });

  it('renders a native exact-route link only when both campaign permissions are present', async () => {
    await renderCard(data, 'ru', true);

    const link = screen.getByRole('link', { name: /Открыть статистику кампании «Кувалда 7000₽»/ });
    expect(link.getAttribute('href')).toBe('/admin/campaigns/4/stats');
    expect(link.querySelector('span[aria-hidden="true"] svg')).toBeTruthy();
    fireEvent.click(link);
    expect(screen.getByTestId('location').textContent).toBe('/admin/campaigns/4/stats');

    cleanup();
    await renderCard(data, 'ru', false);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Кувалда 7000₽')).toBeTruthy();
  });

  it.each([
    [['campaigns:read', 'campaigns:stats'], true],
    [['campaigns:read'], false],
    [['campaigns:stats'], false],
    [[], false],
  ])('requires both dashboard permissions for the detail link: %j', (permissions, expected) => {
    usePermissionStore.setState({ permissions: permissions as string[] });

    expect(
      usePermissionStore.getState().hasAllPermissions('campaigns:read', 'campaigns:stats'),
    ).toBe(expected);
    expect(dashboardSource).toContain(
      "state.hasAllPermissions('campaigns:read', 'campaigns:stats')",
    );
  });

  it('distinguishes an exact zero share from a tiny positive share without fake fill', async () => {
    const tiny: TopCampaignsResponse = {
      ...data,
      total_leads: 1,
      total_paying_leads: 1,
      confirmed_receipts_kopeks: 10_000,
      campaigns: [
        { ...data.campaigns[0], confirmed_receipts_kopeks: 1 },
        { ...data.campaigns[2], confirmed_receipts_kopeks: 0 },
      ],
    };
    const { container } = await renderCard(tiny);

    expect(screen.getByText('<0,1% от всех подтверждённых поступлений')).toBeTruthy();
    expect(screen.getByText('0% от всех подтверждённых поступлений')).toBeTruthy();
    const widths = Array.from(container.querySelectorAll<HTMLDivElement>('div[style]')).map(
      (element) => element.style.width,
    );
    expect(widths).toContain('0.01%');
    expect(widths).toContain('0%');
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('keeps an exact zero share when the total is zero even if an item is malformed-positive', async () => {
    const zeroTotal: TopCampaignsResponse = {
      ...data,
      confirmed_receipts_kopeks: 0,
      campaigns: [{ ...data.campaigns[0], confirmed_receipts_kopeks: 1 }],
    };
    const { container } = await renderCard(zeroTotal);

    expect(screen.getByText('0% от всех подтверждённых поступлений')).toBeTruthy();
    expect(container.querySelector<HTMLDivElement>('div[style]')?.style.width).toBe('0%');
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('hides receipt KPI for every partial mixed-contract response', async () => {
    const missingFields: Array<[string, (response: TopCampaignsResponse) => void]> = [
      ['total leads', (response) => delete response.total_leads],
      ['total paying leads', (response) => delete response.total_paying_leads],
      ['total conversion', (response) => delete response.payment_conversion_rate],
      ['total receipts', (response) => delete response.confirmed_receipts_kopeks],
      ['item leads', (response) => delete response.campaigns[0].leads],
      ['item paying leads', (response) => delete response.campaigns[0].paying_leads],
      ['item conversion', (response) => delete response.campaigns[0].payment_conversion_rate],
      ['item receipts', (response) => delete response.campaigns[0].confirmed_receipts_kopeks],
      [
        'item receipt average',
        (response) => delete response.campaigns[0].avg_confirmed_receipts_per_lead_kopeks,
      ],
    ];

    for (const [, removeField] of missingFields) {
      const mixed = {
        ...data,
        campaigns: data.campaigns.map((campaign) => ({ ...campaign })),
      };
      removeField(mixed);
      await renderCard(mixed);
      expect(screen.queryByText('Поступлений с лида')).toBeNull();
      expect(screen.queryByText(/от всех подтверждённых поступлений/)).toBeNull();
      cleanup();
    }
  });

  it.each([
    [
      'ru',
      'показаны топ-3 из 6',
      'Поступлений с лида',
      'Поступлений на оплатившего',
      'В среднем по всем рекламным кампаниям',
      'от всех подтверждённых поступлений',
      '<0,1% от всех подтверждённых поступлений',
      'Открыть статистику кампании',
    ],
    [
      'en',
      'showing top 3 of 6',
      'Receipts per lead',
      'Receipts per paying lead',
      'Averages across all advertising campaigns',
      'of all confirmed receipts',
      '<0.1% of all confirmed receipts',
      'Open statistics for campaign',
    ],
    [
      'fa',
      'نمایش 3 مورد برتر از 6',
      'دریافتی به‌ازای هر سرنخ',
      'دریافتی به‌ازای هر پرداخت‌کننده',
      'میانگین همه کمپین‌های تبلیغاتی',
      'از کل دریافتی‌های تأییدشده',
      'کمتر از ۰٫۱٪ از کل دریافتی‌های تأییدشده',
      'باز کردن آمار کمپین',
    ],
    [
      'zh',
      '显示前 3 个，共 6 个',
      '每个潜在客户的收款',
      '每个付费客户的收款',
      '所有广告活动的平均值',
      '占全部已确认收款的',
      '占全部已确认收款不到 0.1%',
      '打开活动',
    ],
  ])(
    'resolves every new-contract label from the real %s resource',
    async (language, shownTop, perLead, perPayingLead, averages, share, shareTiny, openStats) => {
      await renderCard(
        {
          ...data,
          total_campaigns: 6,
          confirmed_receipts_kopeks: 10_000,
          campaigns: data.campaigns.map((campaign, index) => ({
            ...campaign,
            confirmed_receipts_kopeks: index === 0 ? 1 : index === 1 ? 5_000 : 0,
          })),
        },
        language,
      );

      expect(document.body.textContent).toContain(shownTop);
      expect(screen.getByText(perLead)).toBeTruthy();
      expect(screen.getByText(perPayingLead)).toBeTruthy();
      expect(screen.getByLabelText(averages)).toBeTruthy();
      expect(document.body.textContent).toContain(share);
      expect(document.body.textContent).toContain(shareTiny);
      expect(document.body.textContent).toContain(openStats);
      expect(document.documentElement.dir).toBe(language === 'fa' ? 'rtl' : 'ltr');
      expect(document.querySelector('[dir="ltr"]')).toBeTruthy();
      if (language !== 'ru') {
        expect(document.body.textContent).not.toMatch(
          /показаны|Поступлений|подтверждённых поступлений|Открыть статистику/,
        );
      }
    },
  );

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
    expect(document.documentElement.dir).toBe('rtl');
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
    expect(screen.queryByText('Receipts per lead')).toBeNull();
    expect(screen.queryByText(/of all confirmed receipts/)).toBeNull();
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('formats a fixed Persian amount as IRR and labels it rial instead of toman', async () => {
    vi.spyOn(currencyApi, 'getExchangeRates').mockResolvedValue({
      USD: 100,
      CNY: 14,
      IRR: 0.0024,
    });
    const instance = createInstance();
    await instance.init({ lng: 'fa', resources: { fa: { translation: fa } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function PersianCurrencyProbe() {
      const { formatAmount, currencySymbol } = useCurrency();
      return <span>{`${formatAmount(20.04)} ${currencySymbol}`}</span>;
    }

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={instance}>
          <PersianCurrencyProbe />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('۸٬۳۵۰ ریال')).toBeTruthy();
    expect(screen.queryByText(/تومان/)).toBeNull();
  });
});
