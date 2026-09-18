// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import type { DeviceFirstOptions, DeviceFirstPrice } from '@/api/deviceFirst';

/**
 * МД-1. Главный живой путь — человек выбирает ячейку с ростом устройств и жмёт «Далее»:
 * сводка подтверждения строится из ЛОКАЛЬНОГО выбора (`price.breakdown`), а не из
 * возобновлённого заказа. Статический рендер до этого шага не доходит — нужен клик.
 */
vi.mock('@/api/deviceFirst', () => ({
  deviceFirstApi: {
    create: vi.fn(),
    clearCreateIntents: vi.fn(),
    get: vi.fn(),
    getOpen: vi.fn().mockResolvedValue(null),
    getPendingPayment: vi.fn(),
    confirm: vi.fn(),
    arm: vi.fn(),
    commit: vi.fn(),
    nativeLaunch: vi.fn(),
    payDirect: vi.fn(),
    nativeLaunchDirect: vi.fn(),
    cancel: vi.fn(),
    abandon: vi.fn(),
    paymentMethods: vi.fn().mockResolvedValue({ methods: [{ key: 'sbp', provider_code: 2 }] }),
    createPaymentAttempt: vi.fn(),
    resumeInvoice: vi.fn(),
  },
}));
vi.mock('@/api/balance', () => ({
  balanceApi: { getPaymentMethods: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/platform', () => ({ usePlatform: () => ({ openLink: vi.fn() }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => value.toFixed(2), currencySymbol: '₽' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'ru' },
    t: (key: string, values?: { count?: number; amount?: string; days?: number }) =>
      values?.amount !== undefined
        ? `${key}:${values.amount}${values.days !== undefined ? `:${values.days}` : ''}`
        : values?.count === undefined
          ? key
          : `${key}:${values.count}`,
  }),
}));

function cell(deviceLimit: number, priceKopeks: number, prorate: number): DeviceFirstPrice {
  return {
    device_limit: deviceLimit,
    price_kopeks: priceKopeks,
    breakdown: {
      base_price_kopeks: 14900,
      devices_price_kopeks: priceKopeks - 14900,
      promo_group_discount_kopeks: 0,
      promo_offer_discount_kopeks: 0,
      upgrade_from_device_limit: 2,
      upgrade_remaining_days: 365,
      upgrade_prorate_kopeks: prorate,
    },
  };
}

const options: DeviceFirstOptions = {
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
  device_options: [2, 3],
  current_subscription: { id: 30, device_limit: 2, is_trial: false },
  balance_kopeks: 100000,
  price_matrix: [{ period_days: 30, prices: [cell(2, 19900, 0), cell(3, 85700, 60800)] }],
};

afterEach(() => cleanup());

describe('МД-1: локальное подтверждение после «Далее»', () => {
  it('выбрал 3 устройства → в сводке подтверждения есть строка про доплату за остаток', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter initialEntries={['/subscription/purchase']}>
        <QueryClientProvider client={queryClient}>
          <DeviceFirstConfigurator
            options={options}
            fixtureMethods={[{ key: 'sbp', provider_code: 2 }]}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('deviceFirst.upgradeProrateNote:608 ₽:365')).toBeNull();
    fireEvent.click(screen.getByText('deviceFirst.deviceCount:3'));
    // Уже на шаге выбора строка под «Итого».
    expect(screen.getAllByText('deviceFirst.upgradeProrateNote:608 ₽:365').length).toBe(1);
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    // И в сводке подтверждения — из локального выбора, без заказа.
    expect(
      (await screen.findAllByText('deviceFirst.upgradeProrateNote:608 ₽:365')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 → 3')).toBeTruthy();
  });
});
