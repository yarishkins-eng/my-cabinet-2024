// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionTab, type SubscriptionTabProps } from './SubscriptionTab';

/**
 * 🔴 Пункт 2.2б. «Создать подписку» в кабинете — единственный живой путь выдать
 * подписку руками. Без выбранного тарифа она создавалась с пустым списком
 * серверов: VPN не работает, ошибки нет (мина A).
 *
 * Сторожим не наличие подписи на экране, а САМО НАЖАТИЕ: пока тариф не выбран,
 * форма отправиться не может, и владелец видит, почему.
 */

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'ru', changeLanguage: vi.fn() },
    }),
  };
});

const TARIFF = { id: 3, name: 'Базовый' } as unknown as SubscriptionTabProps['tariffs'][number];

function renderTab(overrides: Partial<SubscriptionTabProps> = {}) {
  const onUpdateSubscription = vi.fn().mockResolvedValue(undefined);
  const props = {
    userSubscriptions: [],
    selectedSub: null,
    activeSubscriptionId: null,
    onActiveSubscriptionChange: vi.fn(),
    subscriptionDetailView: false,
    onSubscriptionDetailViewChange: vi.fn(),
    tariffs: [TARIFF],
    currentTariff: null,
    subAction: 'extend',
    subDays: 30,
    onSubActionChange: vi.fn(),
    onSubDaysChange: vi.fn(),
    selectedTariffId: null,
    onSelectedTariffIdChange: vi.fn(),
    selectedTrafficGb: '',
    onSelectedTrafficGbChange: vi.fn(),
    panelInfo: null,
    panelInfoLoading: false,
    copyToClipboard: vi.fn(),
    formatBytes: (bytes: number) => String(bytes),
    nodeUsageDays: 7,
    onNodeUsageDaysChange: vi.fn(),
    nodeUsageForPeriod: [],
    devices: [],
    devicesLoading: false,
    devicesTotal: 0,
    deviceLimit: 1,
    editingDeviceHwid: null,
    editingDeviceName: '',
    onEditingDeviceHwidChange: vi.fn(),
    onEditingDeviceNameChange: vi.fn(),
    renameSaving: false,
    requestHistory: [],
    requestHistoryLoading: false,
    requestHistoryTotal: 0,
    requestHistoryOffset: 0,
    requestHistorySubId: null,
    requestHistoryExpanded: false,
    onRequestHistoryExpandedChange: vi.fn(),
    onRequestHistorySubIdChange: vi.fn(),
    actionLoading: false,
    confirmingAction: null,
    onInlineConfirm: vi.fn(),
    onUpdateSubscription,
    onSetDeviceLimit: vi.fn(),
    onAddTraffic: vi.fn(),
    onRemoveTraffic: vi.fn(),
    onResetDevices: vi.fn(),
    onDeleteDevice: vi.fn(),
    onRenameDevice: vi.fn(),
    onLoadDevices: vi.fn(),
    onLoadSubscriptionData: vi.fn(),
    onLoadRequestHistory: vi.fn(),
    hasPermission: () => true,
    formatDate: (date: string | null) => String(date),
    locale: 'ru',
    ...overrides,
  } as unknown as SubscriptionTabProps;

  render(<SubscriptionTab {...props} />);
  return { onUpdateSubscription };
}

function createButton(): HTMLButtonElement {
  // Кнопка выдачи — та, что подписана ключом создания подписки.
  const button = screen
    .getAllByRole('button')
    .find((node) => node.textContent?.includes('admin.users.detail.subscription.create'));
  if (!button) throw new Error('Кнопка «Создать подписку» на экране не найдена');
  return button as HTMLButtonElement;
}

afterEach(() => cleanup());

describe('Выдача подписки из кабинета требует тариф (пункт 2.2б)', () => {
  it('без выбранного тарифа форму отправить нельзя, и причина названа', () => {
    const { onUpdateSubscription } = renderTab({ selectedTariffId: null });

    const button = createButton();
    expect(button.disabled).toBe(true);
    expect(screen.getByText('admin.users.detail.subscription.tariffRequired')).toBeTruthy();

    fireEvent.click(button);
    expect(onUpdateSubscription).not.toHaveBeenCalled();
  });

  it('с выбранным тарифом выдача работает как раньше', () => {
    const { onUpdateSubscription } = renderTab({ selectedTariffId: 3 });

    const button = createButton();
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('admin.users.detail.subscription.tariffRequired')).toBeNull();

    fireEvent.click(button);
    expect(onUpdateSubscription).toHaveBeenCalledWith('create');
  });

  it('подпись про обязательный тариф есть на всех языках кабинета', async () => {
    const dictionaries = import.meta.glob('../../../locales/*.json');
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const load = dictionaries[`../../../locales/${language}.json`];
      expect(load, `нет словаря ${language}`).toBeTruthy();
      const dict = (await load()) as {
        default: { admin: { users: { detail: { subscription: { tariffRequired?: string } } } } };
      };
      const text = dict.default.admin.users.detail.subscription.tariffRequired;
      expect(typeof text === 'string' && text.trim().length > 0).toBe(true);
    }
  });
});
