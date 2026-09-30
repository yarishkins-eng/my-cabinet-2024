import { useTranslation } from 'react-i18next';

import type { DashboardReferrals as Referrals } from '../../api/admin';
import { DASH, LOADING, useLocaleTag, useMoney } from '../sales-stats/salesFormat';

interface DashboardReferralsProps {
  data: Referrals | undefined;
  loading: boolean;
  isError: boolean;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** РЕФ-2: рефералка на «Статистике» (решения владельца 29.09) — тот же счётчик, что утреннее письмо; каждое событие в
 * своём месяце по Москве. Плитки — из последней строки ряда, чтобы одно число не приходило из двух мест. Блок не
 * прячется при сбое: строка ошибки честнее исчезнувшего раздела. */
export function DashboardReferrals({ data, loading, isError }: DashboardReferralsProps) {
  const { t } = useTranslation();
  const format = useMoney();
  const locale = useLocaleTag();
  const blank = loading ? LOADING : DASH;
  const months = data?.months ?? [];
  const current = months[months.length - 1];
  const monthLabel = (month: string) => {
    const name = capitalize(
      new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
        new Date(`${month}-01T00:00:00Z`),
      ),
    );
    // месяц прошлого года — с годом, как в «Деньгах»
    return current && month.slice(0, 4) !== current.month.slice(0, 4)
      ? `${name} ${month.slice(0, 4)}`
      : name;
  };
  const tiles = [
    {
      key: 'came',
      label: t('adminDashboard.referrals.came'),
      value: current ? String(current.came) : blank,
      note:
        data?.came_pct === null || data?.came_pct === undefined
          ? null
          : t('adminDashboard.referrals.cameShare', { percent: data.came_pct }),
    },
    {
      key: 'paidFirst',
      label: t('adminDashboard.referrals.paidFirst'),
      value: current ? String(current.paid_first) : blank,
      note: null,
    },
    {
      key: 'money',
      label: t('adminDashboard.referrals.money'),
      value: current ? format(current.money_kopeks) : blank,
      note:
        data?.money_pct === null || data?.money_pct === undefined
          ? null
          : t('adminDashboard.referrals.moneyShare', { percent: data.money_pct }),
    },
    {
      key: 'rewards',
      label: t('adminDashboard.referrals.rewards'),
      value: current ? format(current.rewards_kopeks) : blank,
      note: t('adminDashboard.referrals.rewardsNote'),
    },
  ];

  return (
    <section className="space-y-4 rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-dark-100 sm:text-lg">
          {t('adminDashboard.referrals.title')}
        </h2>
        <p className="text-xs text-dark-400">{t('adminDashboard.referrals.hint')}</p>
      </div>
      {isError && (
        <p className="text-sm text-error-400">{t('adminDashboard.referrals.loadError')}</p>
      )}

      <div>
        {current && (
          <div className="text-xs text-dark-400">
            {t('adminDashboard.referrals.monthCaption', { month: monthLabel(current.month) })}
          </div>
        )}
        {/* 2×2 и без обрезки подписей: на телефоне 360 px длинные подписи переносятся, а не режутся (ревью L2-1) */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <div key={tile.key} className="min-w-0 rounded-lg bg-dark-800/50 p-3">
              <div className="text-xs text-dark-400">{tile.label}</div>
              <div className="mt-1 text-base font-semibold text-dark-100 sm:text-xl">
                {tile.value}
              </div>
              {tile.note && <div className="mt-0.5 text-xs text-dark-400">{tile.note}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-dark-400">{t('adminDashboard.referrals.byMonths')}</div>
        <div className="text-xs text-dark-400">{t('adminDashboard.referrals.byMonthsHint')}</div>
        {months.length === 0 && <div className="text-sm text-dark-400">{blank}</div>}
        <div className="divide-y divide-dark-700/50">
          {/* строка месяца — карточка в два уровня: пять чисел в одну строку на телефоне не помещаются (ревью L2-2) */}
          {months.map((row) => (
            <div key={row.month} className="space-y-1 py-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-dark-200">{monthLabel(row.month)}</span>
                <span className="whitespace-nowrap font-semibold tabular-nums text-success-400">
                  {t('adminDashboard.referrals.rowMoney', { amount: format(row.money_kopeks) })}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs tabular-nums text-dark-300">
                <span className="min-w-0">
                  {t('adminDashboard.referrals.rowCame', { count: row.came })}
                </span>
                <span className="min-w-0">
                  {t('adminDashboard.referrals.rowTrial', { count: row.trial })}
                </span>
                <span className="min-w-0">
                  {t('adminDashboard.referrals.rowPaidFirst', { count: row.paid_first })}
                </span>
                <span className="min-w-0">
                  {t('adminDashboard.referrals.rowRewards', { amount: format(row.rewards_kopeks) })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
