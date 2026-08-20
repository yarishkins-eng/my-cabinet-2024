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

function createButtons(): HTMLButtonElement[] {
  // Кнопки выдачи — те, что подписаны ключом создания подписки.
  const buttons = screen
    .getAllByRole('button')
    .filter((node) => node.textContent?.includes('admin.users.detail.subscription.create'));
  if (buttons.length === 0) throw new Error('Кнопка «Создать подписку» на экране не найдена');
  return buttons as HTMLButtonElement[];
}

/** Две подписки (одна истёкшая) — это НЕ мультитариф, такое бывает сегодня. */
const TWO_SUBSCRIPTIONS = [
  {
    id: 1,
    tariff_id: 5,
    tariff_name: '⏰Пробный',
    status: 'expired',
    is_active: false,
    is_trial: true,
    traffic_used_gb: 0,
    traffic_limit_gb: 10,
    device_limit: 1,
    days_remaining: 0,
    end_date: '2026-08-01T00:00:00Z',
  },
  {
    id: 2,
    tariff_id: 3,
    tariff_name: 'Базовый',
    status: 'active',
    is_active: true,
    is_trial: false,
    traffic_used_gb: 1.5,
    traffic_limit_gb: 100,
    device_limit: 2,
    days_remaining: 20,
    end_date: '2026-09-10T00:00:00Z',
  },
] as unknown as SubscriptionTabProps['userSubscriptions'];

afterEach(() => cleanup());

describe('Выдача подписки из кабинета требует тариф (пункт 2.2б)', () => {
  it('без выбранного тарифа форму отправить нельзя, и причина названа', () => {
    const { onUpdateSubscription } = renderTab({ selectedTariffId: null });

    const [button] = createButtons();
    expect(button.disabled).toBe(true);
    expect(screen.getByText('admin.users.detail.subscription.tariffRequired')).toBeTruthy();

    fireEvent.click(button);
    expect(onUpdateSubscription).not.toHaveBeenCalled();
  });

  it('с выбранным тарифом выдача работает как раньше', () => {
    const { onUpdateSubscription } = renderTab({ selectedTariffId: 3 });

    const [button] = createButtons();
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('admin.users.detail.subscription.tariffRequired')).toBeNull();

    fireEvent.click(button);
    expect(onUpdateSubscription).toHaveBeenCalledWith('create');
  });

  it('вторая форма выдачи — на экране списка подписок — заперта так же', () => {
    // 🔴 Форм выдачи в компоненте ДВЕ, но на экране всегда ровно одна: блоки
    // взаимоисключающие (`length > 1` против `length <= 1`). Поэтому здесь
    // ждём именно ОДНУ кнопку — но принадлежит она СПИСОЧНОЙ ветке, которую
    // первые два теста не видят вовсе. Экран списка живой уже сегодня:
    // истёкшая подписка остаётся в коллекции, и «две подписки» бывают без
    // мультитарифа. `toBe(1)` вместо «больше нуля» — чтобы тест покраснел,
    // если ветки однажды начнут рисоваться одновременно.
    const { onUpdateSubscription } = renderTab({
      userSubscriptions: TWO_SUBSCRIPTIONS,
      subscriptionDetailView: false,
      selectedTariffId: null,
    });

    const buttons = createButtons();
    expect(buttons.length).toBe(1);
    // Это НЕ та же кнопка, что в первом тесте: там ветка одиночной подписки.
    expect(screen.queryByText('admin.users.detail.subscription.noActive')).toBeNull();

    expect(buttons[0].disabled).toBe(true);
    fireEvent.click(buttons[0]);
    expect(onUpdateSubscription).not.toHaveBeenCalled();
    expect(screen.getAllByText('admin.users.detail.subscription.tariffRequired').length).toBe(1);
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
