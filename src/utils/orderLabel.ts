type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * ВК-16 (16в). Подпись срока и устройств заказа на экранах доплаты — ТЕ ЖЕ ключи и та же формула, что у кассы
 * (`DeviceFirstConfigurator.tsx`, `periodLabel`): человек видит в «Оплате заказа» ровно те слова, что выбрал.
 */
export function orderPeriodLabel(t: Translate, days: number): string {
  if (days === 365) return t('deviceFirst.periodYear');
  if (days % 30 === 0) return t('deviceFirst.periodMonths', { count: days / 30 });
  return t('deviceFirst.periodDays', { count: days });
}

export function orderDevicesLabel(t: Translate, devices: number): string {
  return t('deviceFirst.deviceShort', { count: devices });
}

/** Касса с тем же сроком и устройствами: метка `from=checkout` — единственная, по которой касса их подставляет. */
export function orderCheckoutPath(periodDays?: number | null, devices?: number | null): string {
  if (!periodDays || !devices) return '/subscription/purchase';
  const params = new URLSearchParams({
    from: 'checkout',
    period: String(periodDays),
    devices: String(devices),
  });
  return `/subscription/purchase?${params}`;
}
