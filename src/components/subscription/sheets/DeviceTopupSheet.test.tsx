// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../DeviceAddonFlow', () => ({
  DeviceAddonFlow: () => <div>device-addon-flow</div>,
}));

import { DeviceTopupSheet } from './DeviceTopupSheet';

afterEach(() => cleanup());

it('restores one outer header and closes through the shared reset handler', () => {
  const onClose = vi.fn();
  const onDevicesToAddChange = vi.fn();
  render(
    <DeviceTopupSheet
      open
      onOpen={vi.fn()}
      onClose={onClose}
      subscription={{ id: 44, device_limit: 2 } as never}
      subscriptionId={44}
      devicesToAdd={3}
      onDevicesToAddChange={onDevicesToAddChange}
      purchaseOptions={undefined}
      isDark
    />,
  );

  expect(screen.getByText('subscription.buyDevices')).toBeTruthy();
  const closeButtons = screen.getAllByRole('button', { name: 'common.close' });
  expect(closeButtons).toHaveLength(1);
  fireEvent.click(closeButtons[0]);
  expect(onDevicesToAddChange).toHaveBeenCalledWith(1);
  expect(onClose).toHaveBeenCalledOnce();
});
