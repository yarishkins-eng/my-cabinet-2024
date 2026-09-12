import { readFileSync } from 'node:fs';
import { createInstance, type Resource } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';

const resources: Resource = {
  ru: { translation: ru },
  en: { translation: en },
  zh: { translation: zh },
  fa: { translation: fa },
};
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ resources, fallbackLng: false, interpolation: { escapeValue: false } });
});

const expected = {
  ru: {
    devices: ['1 устройство', '2 устройства', '5 устройств'],
    short: 'устр.',
    summary: '1 устр.',
    day: '1 день',
    until: 'Действует ещё 1 день',
    added: '+1 устройство',
    total: 'Всего устройств: 1',
    minimum: 'Уже достигнут минимальный лимит устройств для вашего тарифа',
  },
  en: {
    devices: ['1 device', '2 devices', '5 devices'],
    short: 'dev.',
    summary: '1 device',
    day: '1 day',
    until: 'Valid for 1 more day',
    added: '+1 device',
    total: 'Total devices: 1',
    minimum: 'Already at minimum device limit for your tariff',
  },
  zh: {
    devices: ['1 台设备', '2 台设备', '5 台设备'],
    short: '台',
    summary: '1 台设备',
    day: '1 天',
    until: '还可使用 1 天',
    added: '+1 台设备',
    total: '总设备数：1',
    minimum: '已达到当前套餐的最低设备限制',
  },
  fa: {
    devices: ['1 دستگاه', '2 دستگاه', '5 دستگاه'],
    short: 'دستگاه',
    summary: '1 دستگاه',
    day: '1 روز',
    until: '1 روز دیگر معتبر است',
    added: '+1 دستگاه',
    total: 'مجموع دستگاه‌ها: 1',
    minimum: 'حداقل محدودیت دستگاه برای تعرفه شما اعمال شده است',
  },
} as const;

describe('ОУ-2: подписи количества устройств', () => {
  it.each(Object.entries(expected))('%s: согласует 1, 2 и 5 на живых экранах', (lng, copy) => {
    const t = i18n.getFixedT(lng);

    for (const [index, count] of [1, 2, 5].entries()) {
      expect(t('landing.devices', { count })).toBe(copy.devices[index]);
    }
    expect(t('admin.users.detail.subscription.devices', { count: 1 })).toBe(copy.devices[0]);
    expect(t('admin.users.detail.gifts.devices', { count: 1 })).toBe(copy.devices[0]);
    expect(t('gift.devicesShort')).toBe(copy.short);
    expect(t('deviceFirst.deviceShort', { count: 1 })).toBe(copy.summary);
    expect(t('deviceFirst.periodDays', { count: 1 })).toBe(copy.day);
    expect(t('subscription.deviceAddon.untilEnd', { count: 1 })).toBe(copy.until);
    expect(t('successNotification.devicesAdded', { count: 1 })).toBe(copy.added);
    expect(t('successNotification.totalDevices', { count: 1 })).toBe(copy.total);
    expect(t('subscription.additionalOptions.alreadyAtMinDeviceLimit')).toBe(copy.minimum);
  });

  it('передаёт count и не печатает число тоста второй раз', () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(source('../components/admin/userDetail/SubscriptionTab.tsx')).toContain(
      "t('admin.users.detail.subscription.devices', {",
    );
    expect(source('../components/admin/userDetail/GiftsTab.tsx')).toContain(
      "t('admin.users.detail.gifts.devices', { count: gift.device_limit })",
    );

    for (const path of [
      '../components/dashboard/TrialOfferCard.tsx',
      '../components/subscription/DeviceAddonFlow.tsx',
      '../components/subscription/sheets/DeviceReductionSheet.tsx',
    ]) {
      expect(source(path)).toContain("t('gift.devicesShort')");
    }

    const success = source('../components/SuccessNotificationModal.tsx');
    expect(success).toContain(
      "t('successNotification.devicesAdded', { count: data.devicesAdded })",
    );
    expect(success).toContain(
      "t('successNotification.totalDevices', { count: data.newDeviceLimit })",
    );
    expect(success).not.toContain('+{data.devicesAdded}');
    expect(success).not.toContain('>{data.newDeviceLimit}</span>');
  });
});
