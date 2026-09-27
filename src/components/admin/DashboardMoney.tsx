import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardMoney as Money, SubscriptionStats } from '../../api/admin';
import { DASH, LOADING, useLocaleTag, useMoney } from '../sales-stats/salesFormat';

interface DashboardMoneyProps {
  money: Money | undefined;
  loading: boolean;
  isError: boolean;
  people: SubscriptionStats | null | undefined;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** СП-1б: деньги вернулись на «Статистику» по решению владельца 27.09 — те же, что «Пришло живых денег» на экране
 * продаж и в утреннем письме (как выписка Platega), сутки и месяцы по Москве; ниже — люди, как на верху панели. */
export function DashboardMoney({ money, loading, isError, people }: DashboardMoneyProps) {
  const { t } = useTranslation();
  const format = useMoney();
  const locale = useLocaleTag();
  const [picked, setPicked] = useState<number | null>(null);
  const blank = loading ? LOADING : DASH;
  const days = money?.days ?? [];
  const months = money?.months ?? [];
  const current = months[months.length - 1];
  const monthLabel = (month: string) => {
    const name = capitalize(
      new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
        new Date(`${month}-01T00:00:00Z`),
      ),
    );
    // месяц прошлого года — с годом, иначе «Декабрь» рядом с «Январём» читается как один год
    return current && month.slice(0, 4) !== current.month.slice(0, 4)
      ? `${name} ${month.slice(0, 4)}`
      : name;
  };
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    );
  const maxDay = Math.max(1, ...days.map((day) => day.kopeks));
  const maxMonth = Math.max(1, ...months.map((month) => month.kopeks));
  const shownIndex = picked ?? days.length - 1;
  const shown = days[shownIndex];
  const tiles = [
    { key: 'today', label: t('adminDashboard.money.today'), kopeks: money?.today_kopeks },
    {
      key: 'month',
      label: current ? monthLabel(current.month) : t('adminDashboard.money.month'),
      kopeks: money?.month_kopeks,
    },
    { key: 'total', label: t('adminDashboard.money.total'), kopeks: money?.total_kopeks },
  ];

  return (
    <section className="space-y-4 rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
      <h2 className="text-base font-semibold text-dark-100 sm:text-lg">
        {t('adminDashboard.money.title')}
      </h2>
      {isError && <p className="text-sm text-error-400">{t('adminDashboard.money.loadError')}</p>}

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.key} className="min-w-0 rounded-lg bg-dark-800/50 p-3">
            <div className="truncate text-xs text-dark-400">{tile.label}</div>
            <div className="mt-1 text-base font-semibold text-success-400 sm:text-xl">
              {tile.kopeks === undefined ? blank : format(tile.kopeks)}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 text-xs text-dark-400">
          <span>{t('adminDashboard.money.byDays')}</span>
          {shown && (
            <span className="text-dark-200">
              {dayLabel(shown.date)}: {format(shown.kopeks)}
            </span>
          )}
        </div>
        {/* столбик нажимается — сверху подпись с суммой дня; по умолчанию — сегодня */}
        <div className="mt-2 flex h-24 items-end gap-[2px]">
          {days.map((day, index) => (
            <button
              key={day.date}
              type="button"
              onClick={() => setPicked(index)}
              aria-label={`${dayLabel(day.date)}: ${format(day.kopeks)}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={`w-full rounded-t-sm ${
                  index === shownIndex ? 'bg-success-300' : 'bg-success-500/60'
                }`}
                style={{
                  height: day.kopeks > 0 ? `${Math.max(4, (day.kopeks / maxDay) * 100)}%` : '1px',
                }}
              />
            </button>
          ))}
        </div>
        {days.length > 0 && (
          <div className="mt-1 flex justify-between text-xs text-dark-400">
            <span>{dayLabel(days[0].date)}</span>
            <span>{dayLabel(days[days.length - 1].date)}</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-dark-400">{t('adminDashboard.money.byMonths')}</div>
        {months.length === 0 && <div className="text-sm text-dark-400">{blank}</div>}
        {months.map((row) => (
          <div
            key={row.month}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 text-sm"
          >
            <span className="truncate text-dark-300">{monthLabel(row.month)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-dark-700/50">
              <div
                className="h-full rounded-full bg-success-500/70"
                style={{ width: `${(row.kopeks / maxMonth) * 100}%` }}
              />
            </div>
            <span className="text-right text-dark-100">{format(row.kopeks)}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs text-dark-400">{t('adminDashboard.money.people')}</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-dark-800/50 p-3">
            <div className="text-xs text-dark-400">{t('adminDashboard.money.paying')}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-dark-100">
              {people?.people_paying ?? DASH}
              {!!people?.new_buyers_today && (
                <span className="text-xs font-normal text-success-400">
                  {t('adminDashboard.money.newToday', { count: people.new_buyers_today })}
                </span>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-dark-800/50 p-3">
            <div className="text-xs text-dark-400">{t('adminDashboard.money.onTrial')}</div>
            <div className="mt-1 text-lg font-semibold text-dark-100">
              {people?.people_on_trial ?? DASH}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
