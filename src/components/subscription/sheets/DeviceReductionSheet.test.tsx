// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getDeviceReductionInfo } = vi.hoisted(() => ({
  getDeviceReductionInfo: vi.fn(),
}));

vi.mock('../../../api/subscription', () => ({
  subscriptionApi: {
    getDeviceReductionInfo,
    reduceDevices: vi.fn(),
  },
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DeviceReductionSheet } from './DeviceReductionSheet';

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeviceReductionSheet
        open
        onOpen={vi.fn()}
        onClose={vi.fn()}
        subscriptionPresent
        subscriptionId={44}
        targetDeviceLimit={1}
        onTargetDeviceLimitChange={vi.fn()}
        isDark
      />
    </QueryClientProvider>,
  );
}

describe('ОУ-2: уменьшение лимита устройств', () => {
  afterEach(() => cleanup());

  it('заменяет серверную английскую причину локализованным текстом на минимуме', async () => {
    getDeviceReductionInfo.mockResolvedValue({
      available: false,
      reason: 'Already at minimum device limit',
      current_device_limit: 1,
      min_device_limit: 1,
      can_reduce: 0,
      connected_devices_count: 1,
    });

    renderSheet();

    expect(
      await screen.findByText('subscription.additionalOptions.alreadyAtMinDeviceLimit'),
    ).toBeTruthy();
    expect(screen.queryByText('Already at minimum device limit')).toBeNull();
  });
});
