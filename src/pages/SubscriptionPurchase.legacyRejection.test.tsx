// @vitest-environment jsdom

// Exercise the real old form, mutation, parent gate and QueryClient together.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SubscriptionPurchase from './SubscriptionPurchase';
import { deviceFirstApi } from '@/api/deviceFirst';
import { subscriptionApi } from '@/api/subscription';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: String, currencySymbol: 'RUB' }),
}));
vi.mock('@/hooks/usePromoDiscount', () => ({
  usePromoDiscount: () => ({ applyPromoDiscount: (price: number) => ({ price }) }),
}));
vi.mock('@/store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
vi.mock('@/components/WebBackButton', () => ({ WebBackButton: () => <button>back</button> }));
vi.mock('@/components/subscription/InsufficientBalanceModal', () => ({ default: () => null }));
vi.mock('@/components/subscription/sheets/SwitchTariffSheet', () => ({
  SwitchTariffSheet: () => null,
}));
vi.mock('@/components/subscription/purchase/ClassicPurchaseWizard', () => ({
  ClassicPurchaseWizard: () => null,
}));
vi.mock('@/components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: () => <div data-testid="new-checkout" />,
}));
vi.mock('@/components/subscription/purchase/TariffPickerGrid', () => ({
  TariffPickerGrid: ({
    tariffs,
    onSelectTariff,
  }: {
    tariffs: Array<{ id: number; name: string }>;
    onSelectTariff: (tariff: { id: number; name: string }) => void;
  }) => (
    <div>
      {tariffs.map((tariff) => (
        <button key={tariff.id} onClick={() => onSelectTariff(tariff)}>
          select-tariff-{tariff.id}
        </button>
      ))}
    </div>
  ),
}));

const clients: QueryClient[] = [];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);
beforeAll(() => {
  // The real form schedules scrolling; jsdom has no layout or scrolling API.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe('A server refusal of the retired form', () => {
  it.each([true, false])(
    'refreshes checkout without repeating purchase, new checkout eligible=%s',
    async (eligible) => {
      vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({
        subscription: null,
      } as never);
      vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
        multi_tariff_enabled: false,
      } as never);
      vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue({
        sales_mode: 'tariffs',
        balance_kopeks: 50000,
        tariffs: [
          {
            id: 3,
            name: 'Basic',
            legacy_purchase_allowed: true,
            periods: [{ days: 30, price_kopeks: 24900, label: '30 days' }],
          },
        ],
      } as never);
      const options = vi
        .spyOn(deviceFirstApi, 'getOptions')
        .mockResolvedValueOnce({ eligible: false, legacy_tariff_purchase_allowed: true })
        // Even a repeated general legacy permission must not reopen a refused form.
        .mockResolvedValue({ eligible, legacy_tariff_purchase_allowed: true });
      const purchase = vi.spyOn(subscriptionApi, 'purchaseTariff').mockRejectedValue({
        response: {
          status: 409,
          data: { detail: { code: 'device_first_required', message: 'Use Device-First' } },
        },
      });
      const pay = vi.spyOn(deviceFirstApi, 'payDirect');
      const nativePay = vi.spyOn(deviceFirstApi, 'nativeLaunchDirect');
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      clients.push(client);
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/subscription/purchase?subscriptionId=42']}>
            <SubscriptionPurchase />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'select-tariff-3' }));
      fireEvent.click(await screen.findByRole('button', { name: 'subscription.purchase' }));
      if (eligible) expect(await screen.findByTestId('new-checkout')).toBeTruthy();
      else expect(await screen.findByText('subscription.checkoutUnavailable')).toBeTruthy();
      await waitFor(() => expect(options).toHaveBeenCalledTimes(2));
      expect(purchase).toHaveBeenCalledExactlyOnceWith(3, 30, undefined, 42);
      expect(screen.queryByRole('button', { name: 'select-tariff-3' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'subscription.purchase' })).toBeNull();
      expect(pay).not.toHaveBeenCalled();
      expect(nativePay).not.toHaveBeenCalled();
    },
  );
  it('removes an already selected tariff when a fresh response revokes its legacy permission', async () => {
    vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({ subscription: null } as never);
    vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
      multi_tariff_enabled: false,
    } as never);
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({
      eligible: false,
      legacy_tariff_purchase_allowed: true,
    });
    const tariff = {
      id: 3,
      name: 'A',
      legacy_purchase_allowed: true,
      periods: [{ days: 30, price_kopeks: 24900, label: '30 days' }],
    };
    const nextTariff = { ...tariff, id: 4, name: 'B' };
    const getPurchaseOptions = vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue({
      sales_mode: 'tariffs',
      balance_kopeks: 50000,
      tariffs: [tariff, nextTariff],
    } as never);
    const purchase = vi.spyOn(subscriptionApi, 'purchaseTariff');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SubscriptionPurchase />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'select-tariff-3' }));
    expect(await screen.findByRole('button', { name: 'subscription.purchase' })).toBeTruthy();
    getPurchaseOptions.mockResolvedValue({
      sales_mode: 'tariffs',
      tariffs: [{ ...tariff, legacy_purchase_allowed: false }, nextTariff],
    } as never);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['purchase-options'] });
    });
    expect(await screen.findByRole('button', { name: 'select-tariff-4' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'select-tariff-3' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'subscription.purchase' })).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
  });
});
