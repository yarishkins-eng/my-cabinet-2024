import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { getGlassColors } from '../../utils/glassTheme';
import { CalendarIcon, GiftIcon } from '@/components/icons';
import type { ScreenState } from '../../hooks/useScreenState';
import type { HomeMeta } from './types';
import TrafficFraction from './TrafficFraction';

/** «до DD.MM» из ISO-даты конца (§16: мелким серым под тарифом). */
function formatUntil(endDate: string | null): string | null {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/**
 * Карточка статуса (§16): слева «Тариф» + название + «до DD.MM» мелким;
 * справа «Осталось» (дни+часы для триала и ≤3 дней, иначе только дни);
 * снизу «Расход трафика» дробью. Перекрытия:
 *  — `accessEnded` → справа красная плашка «Истекла», трафик не рисуем (VPN мёртв);
 *  — `grace` → справа «Бонус-доступ: 2 дня» (подарок, а не обычный отсчёт).
 */
export default function StatusCard({ state, meta }: { state: ScreenState; meta: HomeMeta }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);

  const until = formatUntil(meta.endDate);
  const isGrace = state.code === 'grace';
  const isEnded = state.accessEnded;
  const expiringSoon = !isEnded && !isGrace && meta.daysLeft <= 3;

  // Остаток: дни+часы для триала и «заканчивается» (≤3 дня), иначе только дни (§16).
  const days = Math.max(0, meta.daysLeft);
  const showHours = meta.isTrial || days <= 3;
  const hours = Math.max(0, meta.hoursLeft);
  const remaining = showHours
    ? hours > 0
      ? `${t('subscription.days', { count: days })} ${hours} ${t('home.status.hoursShort')}`
      : t('subscription.days', { count: days })
    : `${days} ${t('subscription.daysShort')}`;

  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider';

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: g.innerBg, border: `1px solid ${g.innerBorder}` }}
    >
      <div className="flex gap-3">
        {/* Тариф + дата */}
        <div className="min-w-0 flex-1">
          <div className={`mb-1 ${labelCls}`} style={{ color: g.textFaint }}>
            {t('dashboard.tariff')}
          </div>
          <div className="truncate text-base font-bold leading-tight text-dark-50">
            {meta.tariffName || t('subscription.currentPlan')}
          </div>
          {until && (
            <div className="mt-0.5 text-[11px] text-dark-50/35">
              {t('dashboard.validUntil', { date: until })}
            </div>
          )}
        </div>

        {/* Осталось / Бонус-доступ / Истекла */}
        <div className="min-w-0 flex-1 text-right">
          {isEnded ? (
            <>
              <div className={`mb-1 ${labelCls}`} style={{ color: g.textFaint }}>
                {t('home.status.remaining')}
              </div>
              <span className="inline-flex items-center rounded-md bg-error-500/15 px-2 py-1 text-sm font-bold text-error-400">
                {t('home.status.expiredPill')}
              </span>
            </>
          ) : isGrace ? (
            <>
              <div
                className={`mb-1 flex items-center justify-end gap-1 ${labelCls}`}
                style={{ color: g.textFaint }}
              >
                <GiftIcon className="h-3 w-3" />
                {t('home.status.bonusAccess')}
              </div>
              <div className="text-base font-bold text-warning-300">
                {t('subscription.days', { count: 2 })}
              </div>
            </>
          ) : (
            <>
              <div
                className={`mb-1 flex items-center justify-end gap-1 ${labelCls}`}
                style={{ color: g.textFaint }}
              >
                <CalendarIcon className="h-3 w-3" />
                {t('home.status.remaining')}
              </div>
              <div
                className={`text-base font-bold ${expiringSoon ? 'text-warning-300' : 'text-dark-50'}`}
              >
                {remaining}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Трафик дробью — прячем, когда доступ закончился (трафик уже не релевантен) */}
      {!isEnded && (
        <div
          className="mt-3 flex items-center justify-between border-t pt-3"
          style={{ borderColor: g.innerBorder }}
        >
          <span className="text-xs text-dark-50/40">{t('home.status.trafficTitle')}</span>
          <TrafficFraction traffic={state.traffic} className="text-sm" />
        </div>
      )}
    </div>
  );
}
