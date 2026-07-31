// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SubscriptionPurchase from './SubscriptionPurchase';

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'subscription') return { isLoading: true };
    if (queryKey[0] === 'device-first-options') {
      return { data: undefined, isLoading: false, isError: true };
    }
    if (queryKey[0] === 'purchase-options') {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      };
    }
    return { data: { multi_tariff_enabled: false } };
  },
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: true }),
}));
vi.mock('@/store/successNotification', () => ({
  useCloseOnSuccessNotification: vi.fn(),
}));
vi.mock('@/components/WebBackButton', () => ({
  WebBackButton: () => <button type="button">back</button>,
}));
vi.mock('@/components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: ({ initialCheckoutId }: { initialCheckoutId?: string | null }) => (
    <div data-testid="restored-checkout">{initialCheckoutId}</div>
  ),
}));

describe('SubscriptionPurchase payment-return recovery', () => {
  afterEach(() => cleanup());

  it('mounts the owned checkout even when unrelated option APIs fail', () => {
    render(
      <MemoryRouter initialEntries={['/subscription/purchase?checkout=owned-checkout']}>
        <SubscriptionPurchase />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('restored-checkout').textContent).toBe('owned-checkout');
    expect(screen.queryByText('subscription.loadError')).toBeNull();
  });
});
