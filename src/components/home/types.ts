import type { ScreenState } from '../../hooks/useScreenState';

/**
 * Метаданные подписки для презентационного слоя верха — то, чего НЕТ в `ScreenState`
 * (он про решение/зоны/флаги, а это про отображение: имя тарифа, дата, остаток).
 * Страница (`DashboardUnified`) и витрина собирают это из подписки/фикстуры.
 */
export interface HomeMeta {
  tariffName: string | null;
  /** ISO-строка конца подписки (для «до DD.MM»). */
  endDate: string | null;
  daysLeft: number;
  hoursLeft: number;
  isTrial: boolean;
  /** Размер grace-бонуса в днях (grace_until − end_date) — для подписи «Бонус-доступ: N дн.». */
  graceDays: number;
}

/**
 * Действия кнопок верха. В Чате 3a проводятся БЕЗОПАСНЫЕ переходы (connect → экран
 * подключения; sell → отдельная страница продления/покупки). Докупка устройств/трафика
 * (шторки) и точная цена — Чат 3b: сюда передаём мост (на деталь) либо no-op.
 */
export interface HomeActions {
  /** «Подключить устройство» / «Подключить ещё». */
  onConnect?: () => void;
  /** «Продлить» / «Оформить» (отдельная страница). */
  onSell?: () => void;
  /** «Докупить устройство» (шторка в 3b; в 3a — мост на деталь). */
  onAddDevice?: () => void;
  /** «Докупить гигабайты» (шторка в 3b; в 3a — мост на деталь). */
  onTopupTraffic?: () => void;
  /** «Проверить оплату» (pending → рефетч подписки). */
  onCheckPayment?: () => void;
  /** «Поддержка» (disabled). */
  onSupport?: () => void;
}

export type { ScreenState };
