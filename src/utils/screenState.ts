/**
 * useScreenState — единый «мозг» объединённого экрана кабинета.
 *
 * Чистая функция `computeScreenState`: на вход данные подписки/устройств/флаги,
 * на выход — РЕШЕНИЕ (уровень, перекрывающее состояние, зоны А/Б, какая кнопка
 * горит, флаги, трафик, видимость ссылки). Визуальный слой (чат 3) только
 * рендерит результат — никаких разбросанных `if`-ов по компонентам.
 *
 * Источник правды по логике:
 *   ПЛАН-объединение-Главная-Подписка.md — §4 (три уровня), §6 (трафик),
 *   §7 (таблица состояний T1–T5 / P1–P9), §16 (финальный визуал), §19 (КОРЕНЬ).
 *
 * Правила, зашитые здесь (НЕ переносить в компоненты):
 *   • «дата важнее статуса»: is_expired проверяем ПЕРВЫМ, до status==='limited' (§4);
 *   • два разных нуля: device_limit===0 = БЕЗЛИМИТ, connectedDevices===0 = счётчик (§19 п.6);
 *   • трафик кончается ТОЛЬКО на лимитном тарифе (§16);
 *   • горит РОВНО ОДНА кнопка (§4/§19 п.8);
 *   • P5а (autopay_will_charge) — ОТЛОЖЕН: заглушка, серверную логику тут НЕ повторяем (§19);
 *   • grace («бонус 2 дня») — отдельная задача чата 5: ветка есть, но по умолчанию выключена.
 */

/** Порог «подписка заканчивается» — 3 дня по «осталось дней» с округлением вниз (§9 п.8). */
const EXPIRING_THRESHOLD_DAYS = 3;
/** Процент трафика, с которого подсвечиваем дробь «у предела» красным (§6). */
const TRAFFIC_CRITICAL_PERCENT = 90;

/**
 * Структурный минимум подписки, нужный для расчёта состояния. Подмножество
 * реального `Subscription` (`types/index.ts`) — чтобы функция не зависела от
 * полей, которые ей не нужны, и тесты строились на лёгких фикстурах.
 */
export interface SubscriptionLike {
  id: number;
  status: string;
  is_trial: boolean;
  is_active: boolean;
  is_expired: boolean;
  is_limited: boolean;
  days_left: number;
  hours_left: number;
  traffic_limit_gb: number; // 0 = безлимит
  traffic_used_gb: number;
  traffic_used_percent: number;
  device_limit: number; // 0 = БЕЗЛИМИТ устройств (не «0 устройств»!)
  subscription_url: string | null;
  hide_subscription_link: boolean;
  is_daily?: boolean;
  autopay_enabled?: boolean;
}

export interface ScreenStateInput {
  /** Каноническая подписка (или null, когда подписки нет). */
  subscription: SubscriptionLike | null;
  /** Сколько устройств реально подключено (devices.total). 0 = счётчик «ноль». */
  connectedDevices: number;
  /** Панель ответила (devices.panel_ok). Дефолт true — пока бэк чата 1 не задеплоен. */
  panelOk?: boolean;
  /** Покупки запрещены админ-ограничением (restriction_subscription). Дефолт false. */
  purchasesRestricted?: boolean;
  /** Докупка устройств доступна (цена>0 и гейт). Дефолт false — кнопку прячем. */
  canTopupDevice?: boolean;
  /** Докупка трафика доступна (tariff.can_topup_traffic). Дефолт false — кнопку прячем. */
  canTopupTraffic?: boolean;
  /** Бонус-доступ «2 дня» (grace, in_grace). Чат 5. Дефолт false. */
  inGrace?: boolean;
  /** Свежий трафик из refresh-traffic (перекрывает значения подписки). */
  trafficOverride?: { usedGb: number; usedPercent: number; isUnlimited: boolean } | null;
  /** Уровень 0 — доступ заблокирован (рисует общий полноэкранный обработчик). Дефолт false. */
  blocked?: boolean;
}

export type ScreenOverlay = 'payment_pending' | 'disabled';

export type ScreenCode =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'
  | 'P5a'
  | 'P6'
  | 'P7'
  | 'P8'
  | 'P9'
  | 'grace';

export type BurningTarget = 'connect' | 'add_device' | 'sell' | 'none';

export interface DeviceZone {
  kind: 'connect' | 'connect_more' | 'add_device' | 'limit_counter' | 'trial_limit' | 'hidden';
  connected: number;
  limit: number; // 0 = безлимит
  unlimited: boolean; // device_limit === 0
  atLimit: boolean; // limit>0 && connected>=limit
}

export interface SellZone {
  kind: 'subscribe' | 'renew' | 'hidden';
}

export interface TrafficInfo {
  usedGb: number;
  limitGb: number; // 0 = безлимит
  unlimited: boolean;
  exhausted: boolean;
  nearLimit: boolean;
}

export interface ScreenState {
  level: 0 | 1 | 2;
  overlay: ScreenOverlay | null;
  code: ScreenCode | null;
  isTrial: boolean;
  accessEnded: boolean; // VPN мёртв (T5/P8) → ссылку и устройства прячем
  deviceZone: DeviceZone;
  sellZone: SellZone;
  burning: BurningTarget;
  trafficExhausted: boolean;
  autopayWillCharge: boolean; // ЗАГЛУШКА — всегда false (P5а отложен)
  panelDown: boolean;
  purchasesRestricted: boolean;
  traffic: TrafficInfo;
  linkVisible: boolean;
  canTopupDevice: boolean;
  canTopupTraffic: boolean;
}

/** Скрытая зона устройств (для перекрывающих/конечных состояний). */
function hiddenDeviceZone(connected: number, limit: number): DeviceZone {
  return {
    kind: 'hidden',
    connected,
    limit,
    unlimited: limit === 0,
    atLimit: false,
  };
}

export function computeScreenState(input: ScreenStateInput): ScreenState {
  const sub = input.subscription;
  const connected = input.connectedDevices;
  const panelOk = input.panelOk ?? true;
  const purchasesRestricted = input.purchasesRestricted ?? false;
  const canTopupDevice = input.canTopupDevice ?? false;
  const canTopupTraffic = input.canTopupTraffic ?? false;
  const inGrace = input.inGrace ?? false;
  const blocked = input.blocked ?? false;

  // Базовая «пустая» заготовка — переиспользуем для уровня 0 и «нет подписки».
  const base: ScreenState = {
    level: 2,
    overlay: null,
    code: null,
    isTrial: sub?.is_trial ?? false,
    accessEnded: false,
    deviceZone: hiddenDeviceZone(connected, sub?.device_limit ?? 0),
    sellZone: { kind: 'hidden' },
    burning: 'none',
    trafficExhausted: false,
    autopayWillCharge: false, // P5а отложен — заглушка
    panelDown: !panelOk,
    purchasesRestricted,
    traffic: {
      usedGb: sub?.traffic_used_gb ?? 0,
      limitGb: sub?.traffic_limit_gb ?? 0,
      unlimited: (sub?.traffic_limit_gb ?? 0) === 0,
      exhausted: false,
      nearLimit: false,
    },
    linkVisible: false,
    canTopupDevice,
    canTopupTraffic,
  };

  // ── Уровень 0 — заблокирован (НЕ наш экран) ────────────────────────────────
  if (blocked) {
    return { ...base, level: 0 };
  }

  // ── Нет подписки → нейтральное скрытое состояние (триал/покупку рисует Dashboard) ──
  if (!sub) {
    return base;
  }

  // ── Общие метрики ──────────────────────────────────────────────────────────
  const deviceUnlimited = sub.device_limit === 0; // БЕЗЛИМИТ устройств
  const atDeviceLimit = !deviceUnlimited && connected >= sub.device_limit;
  const hasFreeSlot = deviceUnlimited || connected < sub.device_limit;
  const zeroDevices = connected === 0;

  const usedGb = input.trafficOverride?.usedGb ?? sub.traffic_used_gb;
  const usedPercent = input.trafficOverride?.usedPercent ?? sub.traffic_used_percent;
  const trafficUnlimited = input.trafficOverride?.isUnlimited ?? sub.traffic_limit_gb === 0;
  // Трафик кончается ТОЛЬКО на лимитном тарифе (§16).
  const trafficExhausted =
    !trafficUnlimited &&
    (sub.is_limited || (sub.traffic_limit_gb > 0 && usedGb >= sub.traffic_limit_gb));
  const nearLimit = !trafficUnlimited && usedPercent >= TRAFFIC_CRITICAL_PERCENT;

  const traffic: TrafficInfo = {
    usedGb,
    limitGb: sub.traffic_limit_gb,
    unlimited: trafficUnlimited,
    exhausted: trafficExhausted,
    nearLimit,
  };

  const deviceZone: DeviceZone = {
    kind: 'hidden',
    connected,
    limit: sub.device_limit,
    unlimited: deviceUnlimited,
    atLimit: atDeviceLimit,
  };

  const withCommon = (over: Partial<ScreenState>): ScreenState => ({
    ...base,
    ...over,
    isTrial: sub.is_trial,
    trafficExhausted,
    panelDown: !panelOk,
    purchasesRestricted,
    traffic,
    canTopupDevice,
    canTopupTraffic,
    deviceZone: over.deviceZone ?? deviceZone,
  });

  // ── Уровень 1 — перекрывающие состояния (приоритет: pending → disabled) ────
  if (sub.status === 'pending') {
    return withCommon({
      level: 1,
      overlay: 'payment_pending',
      deviceZone: { ...deviceZone, kind: 'hidden' },
      sellZone: { kind: 'hidden' },
      burning: 'none',
      linkVisible: false,
    });
  }
  if (sub.status === 'disabled') {
    return withCommon({
      level: 1,
      overlay: 'disabled',
      deviceZone: { ...deviceZone, kind: 'hidden' },
      sellZone: { kind: 'hidden' },
      burning: 'none',
      linkVisible: false,
    });
  }

  // ── Уровень 2 — обычная логика по таблице §7 ───────────────────────────────
  const expired = sub.is_expired; // «дата важнее статуса» — проверяем ПЕРВЫМ
  const expiring = !expired && sub.days_left <= EXPIRING_THRESHOLD_DAYS;
  const linkAllowed = !sub.hide_subscription_link;

  let code: ScreenCode;
  let dz: DeviceZone = deviceZone;
  let sell: SellZone = { kind: 'hidden' };
  let burning: BurningTarget = 'none';
  let accessEnded = false;
  let linkVisible = true;

  // GRACE (бонус 2 дня) — только платным, при истечении, если бэк прислал in_grace.
  if (expired && inGrace && !sub.is_trial) {
    code = 'grace';
    sell = { kind: 'renew' };
    burning = 'sell';
    dz = hasFreeSlot ? { ...deviceZone, kind: 'connect_more' } : { ...deviceZone, kind: 'hidden' };
    accessEnded = false; // VPN ещё работает
    linkVisible = true;
  } else if (expired) {
    // ЗАКОНЧИЛОСЬ (по дате) — всегда, что бы ни лежало в status (вкл. limited).
    accessEnded = true;
    linkVisible = false;
    dz = { ...deviceZone, kind: 'hidden' };
    if (sub.is_trial) {
      code = 'T5';
    } else {
      code = 'P8';
    }
    sell = { kind: sub.is_trial ? 'subscribe' : 'renew' };
    burning = 'sell';
  } else if (sub.is_trial) {
    // ── ТРИАЛ (активный) ──
    if (trafficExhausted) {
      code = 'T4';
      sell = { kind: 'subscribe' };
      burning = 'sell';
      dz = atDeviceLimit
        ? { ...deviceZone, kind: 'trial_limit' }
        : { ...deviceZone, kind: 'connect_more' };
    } else if (zeroDevices) {
      code = 'T1';
      dz = { ...deviceZone, kind: 'connect' };
      burning = 'connect';
    } else if (atDeviceLimit) {
      code = 'T3';
      sell = { kind: 'subscribe' };
      burning = 'sell';
      dz = { ...deviceZone, kind: 'trial_limit' };
    } else {
      code = 'T2';
      sell = { kind: 'subscribe' };
      burning = 'sell';
      dz = { ...deviceZone, kind: 'connect_more' };
    }
  } else {
    // ── ПЛАТНЫЙ (активный) ──
    if (trafficExhausted) {
      // P9 — трафик кончился, дни идут: бесплатное ожидание главным, докупка трафика второстепенной.
      code = 'P9';
      dz = { ...deviceZone, kind: 'hidden' };
      sell = { kind: 'hidden' };
      burning = 'none';
    } else if (expiring) {
      // ≤3 дней. P5а (autopay) отложен — заглушка, ветку не строим.
      if (zeroDevices) {
        code = 'P7';
        dz = { ...deviceZone, kind: 'connect' };
        sell = { kind: 'renew' };
        burning = 'connect';
      } else if (atDeviceLimit) {
        code = 'P6';
        dz = { ...deviceZone, kind: 'limit_counter' }; // докупку устройств прячем
        sell = { kind: 'renew' };
        burning = 'sell';
      } else {
        code = 'P5';
        dz = { ...deviceZone, kind: 'connect_more' };
        sell = { kind: 'renew' };
        burning = 'sell';
      }
    } else {
      // Времени много.
      if (zeroDevices) {
        code = 'P1';
        dz = { ...deviceZone, kind: 'connect' };
        burning = 'connect';
      } else if (atDeviceLimit) {
        if (canTopupDevice) {
          code = 'P3';
          dz = { ...deviceZone, kind: 'add_device' };
          burning = 'add_device';
        } else {
          code = 'P4';
          dz = { ...deviceZone, kind: 'limit_counter' };
          burning = 'none';
        }
      } else {
        code = 'P2';
        dz = { ...deviceZone, kind: 'connect_more' };
        burning = 'none';
      }
    }
  }

  // ── Пост-обработка: покупки запрещены (admin) → прячем платные действия, оставляем бесплатные ──
  if (purchasesRestricted) {
    sell = { kind: 'hidden' };
    if (dz.kind === 'add_device') dz = { ...dz, kind: 'limit_counter' };
    if (burning === 'sell' || burning === 'add_device') {
      burning = dz.kind === 'connect' ? 'connect' : 'none';
    }
  }

  // ── Пост-обработка: панель не ответила → не доверяем «0 устройств → горит Подключить» (§4) ──
  if (!panelOk && burning === 'connect') {
    dz = { ...dz, kind: 'hidden' };
    burning = sell.kind !== 'hidden' ? 'sell' : 'none';
  }

  return withCommon({
    level: 2,
    overlay: null,
    code,
    accessEnded,
    deviceZone: dz,
    sellZone: sell,
    burning,
    linkVisible: linkVisible && linkAllowed,
  });
}
