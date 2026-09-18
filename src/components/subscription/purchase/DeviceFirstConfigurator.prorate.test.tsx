import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import type { DeviceFirstCheckout, DeviceFirstOptions, DeviceFirstPrice } from '@/api/deviceFirst';

/**
 * МД-1 (мина MD). После ДУ-2 (бот, 14.09.2026) ячейка с ростом устройств несёт доплату за
 * остаток текущего срока. Экран обязан (1) считать подпись «₽/мес за устройство» без этой
 * доплаты — иначе 100 → 286 читается как поломка, и (2) объяснить доплату строкой — только
 * там, где она есть. Числа — из живого примера: 2 устройства, год остатка, «3 / 30 дн.» =
 * 249 ₽ + 608 ₽ = 857 ₽.
 */
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink: vi.fn() }),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/api/balance', () => ({
  balanceApi: { getPaymentMethods: vi.fn() },
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'ru' },
    t: (key: string, values?: { count?: number; amount?: number | string; days?: number }) =>
      values?.amount !== undefined
        ? `${key}:${values.amount}${values.days !== undefined ? `:${values.days}` : ''}`
        : values?.count === undefined
          ? key
          : `${key}:${values.count}`,
  }),
}));

function cell(
  deviceLimit: number,
  priceKopeks: number,
  upgrade: { prorate: number; days: number; from: number | null },
): DeviceFirstPrice {
  return {
    device_limit: deviceLimit,
    price_kopeks: priceKopeks,
    breakdown: {
      base_price_kopeks: 14900,
      devices_price_kopeks: priceKopeks - 14900,
      promo_group_discount_kopeks: 0,
      promo_offer_discount_kopeks: 0,
      upgrade_from_device_limit: upgrade.from,
      upgrade_remaining_days: upgrade.days,
      upgrade_prorate_kopeks: upgrade.prorate,
    },
  };
}

function optionsWith(cells: DeviceFirstPrice[]): DeviceFirstOptions {
  return {
    eligible: true,
    tariff: {
      id: 3,
      name: 'Базовый',
      description: '',
      traffic_limit_gb: 0,
      base_device_limit: 1,
      pricing_revision: 9,
    },
    period_options: [30],
    default_period_days: 30,
    device_options: cells.map((c) => c.device_limit),
    current_subscription: { id: 30, device_limit: 2, is_trial: false },
    balance_kopeks: 100000,
    price_matrix: [{ period_days: 30, prices: cells }],
  };
}

function render(options: DeviceFirstOptions, fixtureCheckout: DeviceFirstCheckout | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DeviceFirstConfigurator
          options={options}
          fixtureCheckout={fixtureCheckout}
          fixtureMethods={[{ key: 'sbp', provider_code: 2 }]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const withUpgrade = optionsWith([
  cell(2, 19900, { prorate: 0, days: 365, from: 2 }),
  cell(3, 85700, { prorate: 60800, days: 365, from: 2 }),
]);

describe('МД-1: доплата за остаток объяснена, подпись считается без неё', () => {
  it('подпись «за устройство в месяц» у ячейки с ростом не включает доплату за остаток', () => {
    const html = render(withUpgrade);
    // 857 ₽ − 608 ₽ доплаты = 249 ₽ за месяц на 3 устройствах → 83 ₽/мес за устройство.
    expect(html).toContain('deviceFirst.perDeviceMonth:83');
    expect(html).not.toContain('deviceFirst.perDeviceMonth:286');
    // Ячейка без роста — как раньше: 199 ₽ / 2 устройства = 100.
    expect(html).toContain('deviceFirst.perDeviceMonth:100');
  });

  it('старый бот без ключей доплаты — подпись как раньше', () => {
    const legacy = optionsWith([
      {
        ...cell(3, 24900, { prorate: 0, days: 0, from: null }),
        breakdown: {
          base_price_kopeks: 14900,
          devices_price_kopeks: 10000,
          promo_group_discount_kopeks: 0,
          promo_offer_discount_kopeks: 0,
        },
      },
    ]);
    expect(render(legacy)).toContain('deviceFirst.perDeviceMonth:83');
  });

  it('строка про остаток стоит в сводке заказа только когда доплата есть', () => {
    const base = {
      id: 'checkout-1',
      tariff_id: 3,
      target_subscription_id: 30,
      period_days: 30,
      selected_device_limit: 3,
      quoted_price_kopeks: 85700,
      max_price_kopeks: 85700,
      settlement_mode: 'direct_purchase_v2' as const,
      tariff_total_kopeks: 85700,
      wallet_applied_kopeks: 0,
      external_payable_kopeks: 85700,
      funding_mode: null,
      lifecycle_state: 'awaiting_payment' as const,
      funding_state: 'insufficient' as const,
      provisioning_state: 'not_started' as const,
      terminal_reason: null,
      ui_state: 'awaiting_payment' as const,
      created_subscription_id: null,
      current_device_limit: 2,
      current_subscription_is_trial: false,
      estimated_end_at: '2027-09-14T12:00:00Z',
      expires_at: '2026-09-14T12:15:00Z',
      balance_kopeks: 0,
      shortage_kopeks: 85700,
      top_up_surplus_kopeks: 0,
    };
    const withNote = render(withUpgrade, {
      ...base,
      price_breakdown: withUpgrade.price_matrix![0].prices[1].breakdown,
    } as DeviceFirstCheckout);
    expect(withNote).toContain('deviceFirst.upgradeProrateNote:608 ₽:365');
    expect(withNote).toContain('2 → 3');

    const withoutNote = render(withUpgrade, {
      ...base,
      selected_device_limit: 2,
      tariff_total_kopeks: 19900,
      price_breakdown: withUpgrade.price_matrix![0].prices[0].breakdown,
    } as DeviceFirstCheckout);
    expect(withoutNote).not.toContain('deviceFirst.upgradeProrateNote');

    // Возобновлённое подтверждение (заказ ещё без счёта) берёт доплату из своего же слепка.
    const resumed = render(withUpgrade, {
      ...base,
      lifecycle_state: 'confirmed' as const,
      ui_state: 'confirmation' as const,
      funding_state: 'funded' as const,
      shortage_kopeks: 0,
      balance_kopeks: 100000,
      price_breakdown: withUpgrade.price_matrix![0].prices[1].breakdown,
    } as DeviceFirstCheckout);
    expect(resumed).toContain('deviceFirst.upgradeProrateNote:608 ₽:365');
  });
});

describe('МД-1: правки по ревью (шаг выбора, скидки, сводка без доплаты)', () => {
  it('строка про остаток стоит уже на шаге выбора, когда выбрана ячейка с доплатой', () => {
    // По умолчанию выбран первый вариант устройств — ставим ячейку с ростом первой.
    const html = render(
      optionsWith([
        cell(3, 85700, { prorate: 60800, days: 365, from: 2 }),
        cell(2, 19900, { prorate: 0, days: 365, from: 2 }),
      ]),
    );
    expect(html).toContain('deviceFirst.upgradeProrateNote:608 ₽:365');
  });

  it('на шаге выбора без доплаты строки нет', () => {
    const html = render(optionsWith([cell(2, 19900, { prorate: 0, days: 365, from: 2 })]));
    expect(html).not.toContain('deviceFirst.upgradeProrateNote');
  });

  it('возобновлённое подтверждение без доплаты строку не рисует', () => {
    const html = render(withUpgrade, {
      id: 'checkout-2',
      tariff_id: 3,
      target_subscription_id: 30,
      period_days: 30,
      selected_device_limit: 2,
      price_breakdown: withUpgrade.price_matrix![0].prices[0].breakdown,
      quoted_price_kopeks: 19900,
      max_price_kopeks: 19900,
      settlement_mode: 'direct_purchase_v2',
      tariff_total_kopeks: 19900,
      wallet_applied_kopeks: 0,
      external_payable_kopeks: 0,
      funding_mode: null,
      lifecycle_state: 'confirmed',
      funding_state: 'funded',
      provisioning_state: 'not_started',
      terminal_reason: null,
      ui_state: 'confirmation',
      created_subscription_id: null,
      current_device_limit: 2,
      current_subscription_is_trial: false,
      estimated_end_at: '2027-09-14T12:00:00Z',
      expires_at: '2026-09-14T12:15:00Z',
      balance_kopeks: 100000,
      shortage_kopeks: 0,
      top_up_surplus_kopeks: 0,
    } as DeviceFirstCheckout);
    expect(html).toContain('2 → 2');
    expect(html).not.toContain('deviceFirst.upgradeProrateNote');
  });

  it('при скидке подпись вычитает доплату в той же доле, что скидка уменьшила итог', () => {
    // 857 ₽ со скидкой 50 % = 428,50 ₽; доплата в breakdown сырая (608). Честно: (249 × 0,5) / 3 ≈ 42.
    const discounted: DeviceFirstPrice = {
      device_limit: 3,
      price_kopeks: 42850,
      breakdown: {
        base_price_kopeks: 7450,
        devices_price_kopeks: 35400,
        promo_group_discount_kopeks: 42850,
        promo_offer_discount_kopeks: 0,
        upgrade_from_device_limit: 2,
        upgrade_remaining_days: 365,
        upgrade_prorate_kopeks: 60800,
      },
    };
    const html = render(optionsWith([discounted]));
    expect(html).toContain('deviceFirst.perDeviceMonth:42');
    expect(html).not.toContain('deviceFirst.perDeviceMonth:-');
  });

  it('если доплата съедает всю цену (битые данные) — подписи нет, а не отрицательное число', () => {
    const broken = cell(3, 10000, { prorate: 60800, days: 365, from: 2 });
    const html = render(optionsWith([broken]));
    expect(html).not.toContain('deviceFirst.perDeviceMonth');
  });
});
