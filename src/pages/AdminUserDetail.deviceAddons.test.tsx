// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../i18n', () => ({ default: { language: 'ru' } }));

import { DeviceAddonAdminBlock } from './AdminUserDetail';

const needsAttention = {
  public_id: 'f57bbac7-42c4-4386-93e7-3cd0850e69ad',
  devices_to_add: 2,
  price_kopeks: 10_000,
  purchase_state: 'purchased' as const,
  fulfillment_state: 'needs_attention' as const,
  reason: 'panel_patch_failed|automatic_attempts_exhausted',
  purchased_at: '2026-09-11T10:00:00Z',
  fulfilled_at: null,
  created_at: '2026-09-11T09:59:00Z',
  attempts: [
    {
      public_id: 'bc89517f-7691-4c6a-84b0-59e8e6577770',
      status: 'paid',
      amount_kopeks: 10_000,
      reason: 'wallet_credited_purchase_requires_confirmation',
      created_at: '2026-09-11T10:00:00Z',
    },
  ],
};

describe('AdminUserDetail device add-ons', () => {
  afterEach(cleanup);

  it('shows fulfillment evidence and enables retry only for needs_attention', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <DeviceAddonAdminBlock
        items={[
          needsAttention,
          {
            ...needsAttention,
            public_id: 'b8d52b17-1508-4518-a38d-a318d37403da',
            fulfillment_state: 'ready',
            reason: null,
          },
        ]}
        loading={false}
        canRetry
        retryingId={null}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('admin.users.detail.deviceAddons.title')).toBeTruthy();
    expect(screen.getByText('panel_patch_failed|automatic_attempts_exhausted')).toBeTruthy();
    expect(screen.getAllByText(/wallet_credited_purchase_requires_confirmation/)).toHaveLength(2);
    const buttons = screen.getAllByRole('button', { name: 'admin.users.detail.deviceAddons.retry' });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[0]);
    expect(onRetry).toHaveBeenCalledWith(needsAttention.public_id);
  });

  it('does not render an empty block', () => {
    const { container } = render(
      <DeviceAddonAdminBlock
        items={[]}
        loading={false}
        canRetry
        retryingId={null}
        onRetry={vi.fn()}
      />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
