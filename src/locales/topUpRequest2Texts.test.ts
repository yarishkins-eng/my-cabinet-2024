import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import ru from './ru.json';
import en from './en.json';
import zh from './zh.json';
import fa from './fa.json';
import { orderDevicesLabel, orderPeriodLabel } from '../utils/orderLabel';

describe('ВК-16 16в-3: actual customer copy', () => {
  it('renders Russian order metadata without double full stops', async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: 'ru', resources: { ru: { translation: ru } } });
    const what = [orderPeriodLabel(instance.t, 30), orderDevicesLabel(instance.t, 1)].join(' · ');
    const date = new Date('2026-10-10T00:00:00Z').toLocaleDateString('ru', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const text = instance.t('balance.topUpOrder.fulfilledWhat', { what });
    const until = instance.t('balance.topUpOrder.fulfilledUntil', { date });
    expect(text).toContain(what);
    expect(until).toContain(date);
    expect(text).not.toContain('..');
    expect(until).not.toContain('..');
    expect(instance.t('deviceFirst.orderTitle')).toBe('Ваш заказ');
    expect(instance.t('balance.topUpOrder.toPay')).toBe('К оплате');
    expect(instance.t('deviceFirst.recentPurchaseQuestion')).toBe(
      'За последний час уже была покупка. Оплатить ещё период?',
    );
  });
  it.each([
    ['ru', ru],
    ['en', en],
    ['zh', zh],
    ['fa', fa],
  ] as const)(
    '%s has translated question, order header and equal answer labels',
    (language, locale) => {
      expect(locale.deviceFirst.orderTitle).toBeTruthy();
      expect(locale.deviceFirst.recentPurchaseQuestion).toBeTruthy();
      expect(locale.balance.topUpOrder.morePeriodNo).toBeTruthy();
      expect(locale.balance.topUpOrder.morePeriodYes).toBeTruthy();
      expect(locale.balance.topUpOrder.toPay).toBeTruthy();
      if (language !== 'ru')
        expect(locale.deviceFirst.orderTitle).not.toBe(ru.deviceFirst.orderTitle);
    },
  );
});
