// @vitest-environment jsdom

// 🔴 РЕК-3.1, сторож мины FH. Проверяет НАСТОЯЩИЙ react-query, а не подделку: подмена
// `useQuery` (как в соседнем `SubscriptionPurchase.recovery.test.tsx`) сделала бы сторожа
// круговым — решает исход ровно та опция запроса, которую подделка и стирает.
// ⚠️ `retryDelay: 0` в тестовом клиенте меняет ПАУЗУ между попытками, а не их число:
// собственный `retry` компонента перекрывает умолчание клиента, поэтому возврат правки
// к `retry: false` этот сторож увидит.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SubscriptionPurchase from './SubscriptionPurchase';
import { deviceFirstApi } from '@/api/deviceFirst';
import { subscriptionApi } from '../api/subscription';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
vi.mock('@/components/WebBackButton', () => ({
  WebBackButton: () => <button type="button">back</button>,
}));
vi.mock('@/components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: () => <div data-testid="device-first-configurator" />,
}));

const PURCHASE_OPTIONS = {
  sales_mode: 'tariffs',
  tariffs: [{ id: 3, name: 'Базовый' }],
} as unknown as Awaited<ReturnType<typeof subscriptionApi.getPurchaseOptions>>;

function renderPurchase() {
  const client = new QueryClient({
    // Никаких `retry: false` здесь: умолчание клиента стёрло бы предмет проверки.
    defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  } as ConstructorParameters<typeof QueryClient>[0]);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/subscription/purchase?from=checkout&period=30&devices=2']}>
        <SubscriptionPurchase />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('РЕК-3.1 · мина FH: осечка сети не роняет человека на старую сетку тарифов', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('переспрашивает опции кассы после сетевой осечки и всё равно рисует кассу', async () => {
    const getOptions = vi
      .spyOn(deviceFirstApi, 'getOptions')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ eligible: true });
    vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({
      subscription: null,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscription>>);
    vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(PURCHASE_OPTIONS);
    vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
      multi_tariff_enabled: false,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);

    renderPurchase();

    await waitFor(() => expect(screen.getByTestId('device-first-configurator')).toBeTruthy());
    // Прямая улика повтора: одной попытки было бы достаточно только при `retry: false`,
    // и тогда касса не нарисовалась бы вовсе.
    expect(getOptions.mock.calls.length).toBeGreaterThan(1);
    // И человек не оказался на старой сетке тарифов — ровно то, чем била мина FH.
    expect(screen.queryByText('Базовый')).toBeNull();
  });
});
