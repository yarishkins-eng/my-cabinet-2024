import { useTranslation } from 'react-i18next';
import { PlusIcon, RefreshIcon, StarIcon } from '@/components/icons';
import type { ScreenState } from '../../hooks/useScreenState';
import type { HomeActions } from './types';

/** Монитор-иконка устройства (currentColor — наследует цвет кнопки). */
function DeviceGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

type Variant = 'burning' | 'paid' | 'calm';

/** Стили по иерархии веса (§19 п.8): горящая = заливка+тень; докупка = отдельный
 *  «платный» вид (янтарь, §19 п.11); спокойная = контур. */
const VARIANT: Record<Variant, { btn: string; tile: string; hint: string }> = {
  burning: {
    btn: 'bg-accent-500 text-white shadow-[0_8px_24px_-8px_rgba(var(--color-accent-500),0.55)] hover:bg-accent-600',
    tile: 'bg-white/15',
    hint: 'text-white/75',
  },
  paid: {
    btn: 'border border-warning-400/40 bg-warning-500/15 text-warning-100 shadow-[0_6px_20px_-8px_rgba(var(--color-warning-500),0.45)] hover:bg-warning-500/25',
    tile: 'bg-warning-500/20',
    hint: 'text-warning-200/70',
  },
  calm: {
    btn: 'border border-dark-50/15 text-dark-50/90 hover:bg-dark-50/[0.05]',
    tile: 'bg-dark-50/[0.08]',
    hint: 'text-dark-50/40',
  },
};

function ActionButton({
  variant,
  icon,
  label,
  hint,
  onClick,
}: {
  variant: Variant;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  const v = VARIANT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-all active:scale-[0.99] ${v.btn}`}
    >
      <span
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${v.tile}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        {hint && <span className={`mt-0.5 block text-[11px] ${v.hint}`}>{hint}</span>}
      </span>
    </button>
  );
}

/** Некликабельная строка-счётчик (лимит исчерпан, докупка выкл) или красная
 *  подпись триал-лимита (§9 п.5 / §16). */
function InfoRow({
  icon,
  text,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  text: string;
  tone?: 'neutral' | 'error';
}) {
  const cls =
    tone === 'error'
      ? 'border-error-500/15 bg-error-500/[0.08] text-error-400'
      : 'border-dark-50/[0.08] bg-dark-50/[0.03] text-dark-50/55';
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-3.5 ${cls}`}>
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-dark-50/5">
        {icon}
      </span>
      <span className="text-[13px] font-medium leading-snug">{text}</span>
    </div>
  );
}

/**
 * Зона действия (§4/§16): горящая + при необходимости спокойная. Рисует РОВНО то,
 * что решил `useScreenState` (Чат 2) — никаких новых if-ов по бизнес-логике.
 *
 * Порядок (§4 «горящая сверху, спокойная под ней»): когда горит продажа —
 * sell-кнопка первой, затем устройство; иначе устройство первым (его горящий
 * «Подключить» или спокойный «Подключить ещё»), затем спокойное продление.
 *
 * Над сгибом для P9/T4/limited гарантируем СТАТУС, а не кнопку: у них `burning='none'`
 * и обе зоны спрятаны → здесь не рисуется ничего (статус несут карточка и баннер, §19 п.9).
 */
export default function HeroZone({
  state,
  actions = {},
}: {
  state: ScreenState;
  actions?: HomeActions;
}) {
  const { t } = useTranslation();
  const dz = state.deviceZone;
  const isEnded = state.accessEnded;
  const isGrace = state.code === 'grace';

  // Счётчик устройств «Подключено k из N» — общий для «Подключить» и «Подключить ещё»,
  // чтобы пользователь ВСЕГДА видел доступный лимит устройств. Лимит (`dz.limit`)
  // приходит с сервера (`subscription.device_limit`) → когда админ меняет лимит тарифа
  // (напр. на пробном теперь 2/3/5), кнопка показывает новое число автоматически.
  const deviceCounter = dz.unlimited
    ? t('home.hero.devicesCounterUnlimited', { used: dz.connected })
    : t('home.hero.devicesCounter', { used: dz.connected, max: dz.limit });

  // ── Зона устройства по deviceZone.kind ──
  let deviceNode: React.ReactNode = null;
  if (dz.kind === 'connect') {
    deviceNode = (
      <ActionButton
        variant="burning"
        icon={<DeviceGlyph />}
        label={t('home.hero.connect')}
        hint={deviceCounter}
        onClick={actions.onConnect}
      />
    );
  } else if (dz.kind === 'connect_more') {
    deviceNode = (
      <ActionButton
        variant="calm"
        icon={<DeviceGlyph />}
        label={t('home.hero.connectMore')}
        hint={deviceCounter}
        onClick={actions.onConnect}
      />
    );
  } else if (dz.kind === 'add_device') {
    deviceNode = (
      <ActionButton
        variant="paid"
        icon={<PlusIcon className="h-5 w-5" />}
        label={t('home.hero.addDevice')}
        hint={t('home.hero.addDeviceHint', { used: dz.connected, max: dz.limit })}
        onClick={actions.onAddDevice}
      />
    );
  } else if (dz.kind === 'limit_counter') {
    deviceNode = (
      <InfoRow
        icon={<DeviceGlyph />}
        text={t('home.devices.counter', { used: dz.connected, max: dz.limit })}
      />
    );
  } else if (dz.kind === 'trial_limit') {
    deviceNode = (
      <InfoRow
        tone="error"
        icon={<DeviceGlyph />}
        text={t('home.devices.trialLimit', { used: dz.connected, max: dz.limit })}
      />
    );
  }

  // ── Зона продажи по sellZone.kind ──
  let sellNode: React.ReactNode = null;
  if (state.sellZone.kind === 'subscribe') {
    sellNode = (
      <ActionButton
        variant={state.burning === 'sell' ? 'burning' : 'calm'}
        icon={<StarIcon className="h-5 w-5" />}
        label={t('home.hero.subscribe')}
        hint={isEnded ? undefined : t('home.hero.subscribeHint')}
        onClick={actions.onSell}
      />
    );
  } else if (state.sellZone.kind === 'renew') {
    sellNode = (
      <ActionButton
        variant={state.burning === 'sell' ? 'burning' : 'calm'}
        icon={<RefreshIcon className="h-5 w-5" />}
        label={t('home.hero.renew')}
        hint={
          isGrace
            ? t('home.hero.renewHintGrace')
            : isEnded
              ? undefined
              : t('home.hero.renewHintExpiring')
        }
        onClick={actions.onSell}
      />
    );
  }

  if (!deviceNode && !sellNode) return null;

  // Горящая сверху: при горящей продаже sell первым, иначе устройство первым.
  const sellFirst = state.burning === 'sell';
  return (
    <div className="space-y-2.5">
      {sellFirst ? (
        <>
          {sellNode}
          {deviceNode}
        </>
      ) : (
        <>
          {deviceNode}
          {sellNode}
        </>
      )}
    </div>
  );
}
