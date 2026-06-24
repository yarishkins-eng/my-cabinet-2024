import {
  computeScreenState,
  type ScreenStateInput,
  type SubscriptionLike,
} from '../utils/screenState';
import HeroZone from '../components/home/HeroZone';
import StatusCard from '../components/home/StatusCard';
import OverlayBanner from '../components/home/OverlayBanner';
import { HomeSkeleton, HomeError, PanelDownNotice } from '../components/home/HomeStates';
import ConnectionLinkCard from '../components/home/ConnectionLinkCard';
import DevicesPanel from '../components/home/DevicesPanel';
import type { HomeMeta } from '../components/home/types';
import type { Device } from '../types';

// Демо-устройства для НИЗА витрины (Чат 3b). Чисто визуально, без сети:
// DevicesPanel prop-driven, а ConnectionLinkCard в витрине получает subscriptionId=undefined
// → его запрос ссылки отключён (enabled:false), ссылка рисуется из subscription_url фикстуры.
const DEMO_DEVICES: Device[] = [
  {
    hwid: 'A1B2C3D4E5F6',
    platform: 'iOS',
    device_model: 'iPhone 15',
    created_at: null,
    local_name: 'Мой телефон',
  },
  {
    hwid: '9F8E7D6C5B4A',
    platform: 'Android',
    device_model: 'Pixel 8',
    created_at: null,
    local_name: null,
  },
  {
    hwid: '11223344AABB',
    platform: 'Windows',
    device_model: 'ПК',
    created_at: null,
    local_name: null,
  },
];
const demoDevices = (n: number) =>
  DEMO_DEVICES.slice(0, Math.max(0, Math.min(n, DEMO_DEVICES.length)));

/**
 * Dev-витрина состояний экрана (Чат 3a). Песочница: прогоняет ФИКСТУРЫ через тот же
 * `computeScreenState`, что и боевой экран, и рисует ВЕРХ по каждому коду/overlay/«скучному».
 * Без авторизации/прода — инструмент сверки с макетом (§16). Доступна только под флагом
 * `SCREEN_SHOWCASE_ENABLED` (dev). Здесь нарочно используем фейковые данные и фейковые даты.
 */

const NOW = Date.now();
const endIn = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function baseSub(over: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    id: 1,
    status: 'active',
    is_trial: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    days_left: 30,
    hours_left: 0,
    traffic_limit_gb: 100,
    traffic_used_gb: 42,
    traffic_used_percent: 42,
    device_limit: 3,
    subscription_url: 'https://sub.example/abc',
    hide_subscription_link: false,
    is_daily: false,
    autopay_enabled: false,
    ...over,
  };
}

interface Fixture {
  id: string;
  label: string;
  input: ScreenStateInput;
  meta: HomeMeta;
  disabledReasonHint?: string | null;
  graceUntil?: string | null;
}

function fx(
  id: string,
  label: string,
  s: SubscriptionLike,
  input: Partial<ScreenStateInput> = {},
  extra: {
    tariffName?: string;
    endDate?: string;
    disabledReasonHint?: string | null;
    graceUntil?: string | null;
  } = {},
): Fixture {
  return {
    id,
    label,
    input: { subscription: s, connectedDevices: input.connectedDevices ?? 0, ...input },
    meta: {
      tariffName: extra.tariffName ?? 'Team',
      endDate: extra.endDate ?? endIn(s.days_left),
      daysLeft: s.days_left,
      hoursLeft: s.hours_left,
      isTrial: s.is_trial,
      graceDays: 2,
    },
    disabledReasonHint: extra.disabledReasonHint,
    graceUntil: extra.graceUntil,
  };
}

const trial = (over: Partial<SubscriptionLike> = {}) =>
  baseSub({
    is_trial: true,
    traffic_limit_gb: 10,
    traffic_used_gb: 2.3,
    traffic_used_percent: 23,
    device_limit: 5,
    days_left: 3,
    hours_left: 5,
    ...over,
  });

const FIXTURES: Fixture[] = [
  // ── Триал T1–T5 ──
  fx(
    'T1',
    'Триал · 0 устройств',
    trial({ traffic_used_gb: 0, traffic_used_percent: 0 }),
    { connectedDevices: 0 },
    { tariffName: 'Пробный' },
  ),
  fx('T2', 'Триал · есть слот', trial(), { connectedDevices: 2 }, { tariffName: 'Пробный' }),
  fx(
    'T3',
    'Триал · лимит устройств',
    trial({ device_limit: 2 }),
    { connectedDevices: 2 },
    { tariffName: 'Пробный' },
  ),
  fx(
    'T4',
    'Триал · трафик кончился',
    trial({ is_limited: true, traffic_used_gb: 10, traffic_used_percent: 100 }),
    { connectedDevices: 2 },
    { tariffName: 'Пробный' },
  ),
  fx(
    'T5',
    'Триал · закончился',
    trial({ is_expired: true, status: 'expired', days_left: 0, hours_left: 0 }),
    { connectedDevices: 2 },
    { tariffName: 'Пробный', endDate: endIn(0) },
  ),

  // ── Платные P1–P9 ──
  fx('P1', 'Оплачено · 0 устройств', baseSub(), { connectedDevices: 0 }),
  fx('P2', 'Оплачено · есть слот', baseSub(), { connectedDevices: 1 }),
  fx('P3', 'Оплачено · лимит, докупка ВКЛ', baseSub(), {
    connectedDevices: 3,
    canTopupDevice: true,
  }),
  fx('P4', 'Оплачено · лимит, докупка ВЫКЛ', baseSub(), { connectedDevices: 3 }),
  fx(
    'P5',
    'Оплачено · ≤3 дня, есть слот',
    baseSub({ days_left: 2, hours_left: 23 }),
    { connectedDevices: 1 },
    { endDate: endIn(2) },
  ),
  fx(
    'P6',
    'Оплачено · ≤3 дня, лимит',
    baseSub({ days_left: 2, hours_left: 10 }),
    { connectedDevices: 3, canTopupDevice: true },
    { endDate: endIn(2) },
  ),
  fx(
    'P7',
    'Оплачено · ≤3 дня, 0 устройств',
    baseSub({ days_left: 1, hours_left: 8 }),
    { connectedDevices: 0 },
    { endDate: endIn(1) },
  ),
  fx(
    'P8',
    'Оплачено · закончилось',
    baseSub({ is_expired: true, status: 'expired', days_left: 0, hours_left: 0 }),
    { connectedDevices: 2 },
    { endDate: endIn(0) },
  ),
  fx(
    'P9',
    'Оплачено · трафик кончился',
    baseSub({ is_limited: true, traffic_used_gb: 100, traffic_used_percent: 100, days_left: 20 }),
    { connectedDevices: 2, canTopupTraffic: true },
    { endDate: endIn(20) },
  ),

  // ── Особые ──
  fx(
    'grace',
    'Бонус 2 дня (grace)',
    baseSub({ is_expired: true, status: 'expired', days_left: 0, hours_left: 0 }),
    { connectedDevices: 1, inGrace: true },
    { endDate: endIn(0), graceUntil: '14.07' },
  ),
  fx('pending', 'Платёж обрабатывается', baseSub({ status: 'pending', is_active: false }), {
    connectedDevices: 1,
  }),
  fx('disabled', 'Временно отключён', baseSub({ status: 'disabled' }), { connectedDevices: 1 }),
  fx(
    'disabled-channel',
    'Отключён · канал',
    baseSub({ status: 'disabled' }),
    { connectedDevices: 1 },
    { disabledReasonHint: 'channel' },
  ),
  fx('panel-down', 'Панель не ответила', baseSub(), { connectedDevices: 0, panelOk: false }),
  fx(
    'restricted',
    'Покупки запрещены (P5)',
    baseSub({ days_left: 2, hours_left: 4 }),
    { connectedDevices: 1, purchasesRestricted: true },
    { endDate: endIn(2) },
  ),
  fx(
    'near-limit',
    'Трафик у предела (≥90%)',
    baseSub({ traffic_used_gb: 95, traffic_used_percent: 95 }),
    { connectedDevices: 1 },
  ),
  // Безлимит ТРАФИКА (реальный сценарий) — у тарифа traffic_limit_gb=0. Устройства
  // при этом с обычным лимитом: безлимит устройств в бизнесе не предлагается.
  fx(
    'unlimited-traffic',
    'Безлимит трафика',
    baseSub({ traffic_limit_gb: 0, traffic_used_gb: 42, device_limit: 3 }),
    { connectedDevices: 1 },
  ),
];

/** Один «телефон» витрины: метка + отрисованный верх по фикстуре. */
function StateCard({ f }: { f: Fixture }) {
  const state = computeScreenState(f.input);
  const noop = () => {};
  const actions = {
    onConnect: noop,
    onSell: noop,
    onAddDevice: noop,
    onTopupTraffic: noop,
    onCheckPayment: noop,
    onSupport: noop,
  };
  const showPanelDown = state.panelDown && !state.overlay && !state.accessEnded;

  return (
    <div className="w-[360px] rounded-3xl border border-dark-50/10 bg-dark-50/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-accent-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-accent-300">
          {f.id}
        </span>
        <span className="text-[13px] text-dark-50/60">{f.label}</span>
      </div>
      <div className="space-y-3">
        {showPanelDown && <PanelDownNotice />}
        <OverlayBanner
          state={state}
          actions={actions}
          disabledReasonHint={f.disabledReasonHint}
          graceUntil={f.graceUntil}
        />
        <HeroZone state={state} actions={actions} />
        {/* как в DashboardUnified: при overlay (платёж/отключён) карточку прячем */}
        {!state.overlay && <StatusCard state={state} meta={f.meta} />}

        {/* НИЗ (Чат 3b): ссылка + устройства. Те же правила видимости, что на экране. */}
        {!state.overlay && !state.accessEnded && (
          <>
            <ConnectionLinkCard
              subscriptionId={undefined}
              subscriptionUrl={f.input.subscription?.subscription_url ?? null}
              visible={state.linkVisible}
            />
            <DevicesPanel
              subscriptionId={undefined}
              devices={demoDevices(f.input.connectedDevices)}
              total={f.input.connectedDevices}
              deviceLimit={f.input.subscription?.device_limit ?? 0}
              isLoading={false}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function ScreenStateShowcase() {
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1180px]">
        <h1 className="mb-1 text-2xl font-bold text-dark-50">
          Витрина состояний — экран целиком (Чат 3a верх + 3b низ)
        </h1>
        <p className="mb-6 text-sm text-dark-400">
          Все состояния прогнаны через тот же <code>computeScreenState</code>, что и боевой экран.
          Это песочница на фикстурах (без авторизации/прода) для сверки с макетом §16. Низ (ссылка +
          устройства) — на демо-данных, без обращений к сети.
        </p>

        <div className="flex flex-wrap gap-4">
          {FIXTURES.map((f) => (
            <StateCard key={f.id} f={f} />
          ))}

          {/* «Скучные» состояния оболочки (не из computeScreenState) */}
          <div className="w-[360px] rounded-3xl border border-dark-50/10 bg-dark-50/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-md bg-dark-50/10 px-2 py-0.5 font-mono text-[11px] font-bold text-dark-50/60">
                load
              </span>
              <span className="text-[13px] text-dark-50/60">Загрузка (skeleton)</span>
            </div>
            <HomeSkeleton />
          </div>

          <div className="w-[360px] rounded-3xl border border-dark-50/10 bg-dark-50/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-md bg-dark-50/10 px-2 py-0.5 font-mono text-[11px] font-bold text-dark-50/60">
                error
              </span>
              <span className="text-[13px] text-dark-50/60">Ошибка сети</span>
            </div>
            <HomeError onRetry={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}
