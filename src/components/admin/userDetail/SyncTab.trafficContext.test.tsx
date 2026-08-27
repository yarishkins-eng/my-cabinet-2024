// @vitest-environment jsdom

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PanelSyncStatusResponse,
  UserDetailResponse,
  UserPanelInfo,
} from '../../../api/adminUsers';
import { SyncTab, type SyncTabProps } from './SyncTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const USER = { remnawave_uuid: 'panel-record' } as UserDetailResponse;
const PANEL_INFO = {
  found: true,
  used_traffic_bytes: 0,
  lifetime_used_traffic_bytes: 1_250_382_390,
} as UserPanelInfo;

function createSyncStatus(
  overrides: Partial<PanelSyncStatusResponse> = {},
): PanelSyncStatusResponse {
  return {
    remnawave_uuid: 'panel-record',
    bot_traffic_used_gb: 0,
    bot_device_limit: 1,
    bot_squads: [],
    panel_found: true,
    panel_traffic_used_gb: 0,
    panel_device_limit: 1,
    panel_squads: [],
    has_differences: false,
    differences: [],
    ...overrides,
  } as unknown as PanelSyncStatusResponse;
}

function renderTab(overrides: Partial<SyncTabProps> = {}) {
  const onSyncFromPanel = vi.fn();
  const onSyncToPanel = vi.fn();
  render(
    <SyncTab
      user={USER}
      syncStatus={createSyncStatus()}
      userSubscriptions={[]}
      activeSubscriptionId={2}
      onActiveSubscriptionChange={vi.fn()}
      actionLoading={false}
      onSyncFromPanel={onSyncFromPanel}
      onSyncToPanel={onSyncToPanel}
      panelInfo={PANEL_INFO}
      panelInfoLoading={false}
      formatBytes={(bytes) => (bytes === 0 ? '0 B' : '1.16 GB')}
      locale="ru-RU"
      {...overrides}
    />,
  );
  return { onSyncFromPanel, onSyncToPanel };
}

afterEach(() => cleanup());

describe('Контекст трафика в синхронизации', () => {
  it('показывает current отдельно от накопленного и не меняет sync callbacks', () => {
    const { onSyncFromPanel, onSyncToPanel } = renderTab();

    expect(
      screen.getAllByText(
        (_content, element) => element?.textContent === 'admin.users.detail.sync.traffic:',
      ),
    ).toHaveLength(2);
    expect(screen.getByText('admin.users.detail.sync.panelLifetime')).toBeTruthy();
    expect(screen.getByText('1.16 GB')).toBeTruthy();
    expect(screen.getByText('admin.users.detail.sync.scopeHint')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'admin.users.detail.sync.fromPanel' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.detail.sync.toPanel' }));
    expect(onSyncFromPanel).toHaveBeenCalledOnce();
    expect(onSyncToPanel).toHaveBeenCalledOnce();
  });

  it('не рисует lifetime, пока новая запись грузится или панель её не нашла', () => {
    renderTab({ panelInfo: PANEL_INFO, panelInfoLoading: true });
    expect(screen.queryByText('1.16 GB')).toBeNull();
    cleanup();
    renderTab({ panelInfo: { ...PANEL_INFO, found: false }, panelInfoLoading: false });
    expect(screen.queryByText('1.16 GB')).toBeNull();
  });

  it('не называет отсутствующую панель синхронизированной', () => {
    renderTab({ syncStatus: createSyncStatus({ panel_found: false }), panelInfo: null });
    expect(screen.getByText('admin.users.detail.sync.panelUnavailable')).toBeTruthy();
    expect(screen.queryByText('admin.users.detail.sync.synced')).toBeNull();
    expect(screen.queryByText('admin.users.detail.sync.scopeHint')).toBeNull();
  });

  it('берёт panelInfo из текущего query key, а не из устаревшего state', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/pages/AdminUserDetail.tsx'), 'utf8');
    expect(source.match(/panelInfo=\{panelInfoQuery\.data \?\? null\}/g)).toHaveLength(3);
  });
});
