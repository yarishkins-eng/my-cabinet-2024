// @vitest-environment jsdom

/**
 * ВК-4 (АП-0), мина NM: настройка, заданная в .env на сервере, из кабинета не меняется — сервер
 * отвечает 409. До этапа экран рисовал на её месте обычный переключатель, а отказ проглатывал:
 * переключатель молча возвращался назад, и человек не понимал, сохранилось ли.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSetting } = vi.hoisted(() => ({ updateSetting: vi.fn() }));

vi.mock('../../api/adminSettings', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/adminSettings')>('../../api/adminSettings');
  return {
    ...actual,
    adminSettingsApi: { ...actual.adminSettingsApi, updateSetting, resetSetting: vi.fn() },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import type { SettingDefinition } from '../../api/adminSettings';
import { ToastProvider } from '../Toast';
import { QuickToggles } from './QuickToggles';
import { SettingsTab } from './SettingsTab';
import { SettingsTableRow } from './SettingsTableRow';

function setting(overrides: Partial<SettingDefinition> = {}): SettingDefinition {
  return {
    key: 'WEBHOOK_NOTIFY_SUB_EXPIRED',
    name: 'WEBHOOK_NOTIFY_SUB_EXPIRED',
    category: { key: 'WEBHOOK', label: 'Вебхуки' },
    type: 'bool',
    is_optional: false,
    current: true,
    original: true,
    has_override: false,
    read_only: false,
    env_locked: false,
    choices: [],
    hint: null,
    ...overrides,
  };
}

function row(item: SettingDefinition) {
  return render(
    <SettingsTableRow
      setting={item}
      isFavorite={false}
      onToggleFavorite={() => {}}
      onUpdate={() => {}}
      onReset={() => {}}
    />,
  );
}

function rejection(status: number) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', { headers }, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers },
    data: { detail: "Setting 'X' is fixed in the environment (.env)" },
  });
}

function renderTab(items: SettingDefinition[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsTab
          categories={[{ key: 'WEBHOOK', label: 'Вебхуки', settings: items }]}
          searchQuery=""
          filteredSettings={items}
          isFavorite={() => false}
          toggleFavorite={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ВК-4, мина NM: настройка с сервера не притворяется переключателем', () => {
  // Тело в фигурных скобках: стрелка, возвращающая мок, превратила бы его в «уборку» после теста.
  beforeEach(() => {
    updateSetting.mockReset();
  });
  afterEach(cleanup);

  it('ключ из .env — замок «задано на сервере» и значение, а не переключатель', () => {
    row(setting({ env_locked: true }));

    expect(screen.getByText('admin.settings.badgeServer')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('admin.settings.enabled')).toBeTruthy();
  });

  it('обычный ключ по-прежнему с переключателем и без замка', () => {
    row(setting());

    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.queryByText('admin.settings.badgeServer')).toBeNull();
  });

  it('быстрые переключатели не предлагают ключ с сервера', () => {
    render(
      <QuickToggles
        settings={[
          setting({ key: 'A_FROM_ENV', name: 'A_FROM_ENV', env_locked: true }),
          setting({ key: 'B_FREE', name: 'B_FREE' }),
        ]}
        onUpdate={() => {}}
      />,
    );

    expect(screen.queryByText('admin.settings.settingNames.A FROM ENV')).toBeNull();
    expect(screen.getByText('admin.settings.settingNames.B FREE')).toBeTruthy();
  });

  it.each([
    [409, 'admin.settings.lockedOnServer'],
    [500, 'admin.settings.saveFailed'],
  ])('отказ сохранения %s сказан словами, а не проглочен', async (status, text) => {
    updateSetting.mockRejectedValue(rejection(status));
    renderTab([setting()]);

    // Первый переключатель на экране — в блоке быстрых, второй — в строке; оба зовут сохранение.
    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    expect(updateSetting).toHaveBeenCalledWith('WEBHOOK_NOTIFY_SUB_EXPIRED', 'false');
  });
});
