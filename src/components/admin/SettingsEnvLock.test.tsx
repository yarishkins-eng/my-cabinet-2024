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

const { updateSetting, resetSetting } = vi.hoisted(() => ({
  updateSetting: vi.fn(),
  resetSetting: vi.fn(),
}));

vi.mock('../../api/adminSettings', async () => {
  const actual =
    await vi.importActual<typeof import('../../api/adminSettings')>('../../api/adminSettings');
  return {
    ...actual,
    adminSettingsApi: { ...actual.adminSettingsApi, updateSetting, resetSetting },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import type { SettingDefinition } from '../../api/adminSettings';
import { ToastProvider } from '../Toast';
import { FavoritesTab } from './FavoritesTab';
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

function rejection(
  status: number,
  detail: unknown = "Setting 'X' is fixed in the environment (.env)",
) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', { headers }, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers },
    data: { detail },
  });
}

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderTab(items: SettingDefinition[], client = queryClient()) {
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
    resetSetting.mockReset();
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

  it('под замком — подпись варианта, прочерк вместо пустоты и длинное значение целиком', () => {
    const long = '30:0,60:5,90:10,180:15,360:20,720:25,1440:30';
    const { unmount } = row(
      setting({
        type: 'str',
        current: 'cabinet',
        env_locked: true,
        choices: [{ value: 'cabinet', label: '🏠 Кабинет' }],
      }),
    );
    expect(screen.getByText('🏠 Кабинет')).toBeTruthy();
    expect(screen.queryByText('cabinet')).toBeNull();
    unmount();

    const empty = row(setting({ type: 'str', current: '', env_locked: true }));
    expect(screen.getByText('—')).toBeTruthy();
    empty.unmount();

    row(
      setting({
        key: 'X_DISCOUNTS',
        name: 'X_DISCOUNTS',
        type: 'str',
        current: long,
        env_locked: true,
      }),
    );
    const value = screen.getByText(long);
    expect(value.className).not.toContain('truncate');
  });

  it('над списком сказано, где меняются настройки под замком', () => {
    renderTab([setting({ env_locked: true })]);
    expect(screen.getByText('admin.settings.serverLockedHint')).toBeTruthy();
    cleanup();
    renderTab([setting()]);
    expect(screen.queryByText('admin.settings.serverLockedHint')).toBeNull();
  });

  it('409 обнуления тестового аккаунта не выдаётся за «задано на сервере»', async () => {
    updateSetting.mockRejectedValue(rejection(409, { code: 'account_test_reset_busy' }));
    renderTab([setting()]);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByText('admin.settings.saveFailed')).toBeTruthy());
    expect(screen.queryByText('admin.settings.lockedOnServer')).toBeNull();
  });

  it('неудачный сброс называется сбросом, а не сохранением', async () => {
    resetSetting.mockRejectedValue(rejection(500));
    renderTab([setting({ has_override: true })]);
    fireEvent.click(screen.getAllByLabelText('admin.settings.reset')[0]);
    await waitFor(() => expect(screen.getByText('admin.settings.resetFailed')).toBeTruthy());
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

  it('после отказа список перечитывается: переключатель встаёт в правду сервера', async () => {
    updateSetting.mockRejectedValue(rejection(409));
    const client = queryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderTab([setting()], client);

    fireEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => expect(screen.getByText('admin.settings.lockedOnServer')).toBeTruthy());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-settings'] });
  });

  it('подсказка о замке видна, если под замком хоть одна настройка из многих', () => {
    renderTab([setting({ env_locked: true }), setting({ key: 'FREE', name: 'FREE' })]);
    expect(screen.getByText('admin.settings.serverLockedHint')).toBeTruthy();
  });

  it('«Избранное» тоже говорит словами об отказе сохранения и сброса', async () => {
    updateSetting.mockRejectedValue(rejection(409));
    resetSetting.mockRejectedValue(rejection(500));
    const favorites = () =>
      render(
        <QueryClientProvider client={queryClient()}>
          <ToastProvider>
            <FavoritesTab
              settings={[setting({ has_override: true })]}
              isFavorite={() => true}
              toggleFavorite={() => {}}
            />
          </ToastProvider>
        </QueryClientProvider>,
      );

    favorites();
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(screen.getByText('admin.settings.lockedOnServer')).toBeTruthy());
    cleanup();

    favorites();
    fireEvent.click(screen.getAllByLabelText('admin.settings.reset')[0]);
    await waitFor(() => expect(screen.getByText('admin.settings.resetFailed')).toBeTruthy());
  });

  it('у настройки под замком нет ни значка «БД», ни кнопки «Сбросить»', () => {
    row(setting({ env_locked: true, has_override: true }));
    expect(screen.queryByText('admin.settings.badgeDb')).toBeNull();
    expect(screen.queryByLabelText('admin.settings.reset')).toBeNull();
  });

  it('настройка только для чтения — тоже замок, а не переключатель', () => {
    row(setting({ read_only: true }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('admin.settings.badgeEnv')).toBeTruthy();
  });

  it('пустое (null) значение под замком — прочерк, а не слово null', () => {
    row(setting({ type: 'str', current: null as unknown as string, env_locked: true }));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });
});
