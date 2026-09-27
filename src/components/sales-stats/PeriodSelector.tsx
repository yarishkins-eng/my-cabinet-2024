import { useTranslation } from 'react-i18next';

import type { SalesPeriodName, SalesPeriodParams } from '../../api/adminSalesStats';
import { DateField } from '../DateField';

interface PeriodSelectorProps {
  value: SalesPeriodParams;
  onChange: (period: SalesPeriodParams) => void;
}

/** Кнопки шлют ИМЯ периода; окно в сутках по Москве считает сервер — у телефона в другом поясе
 * «этот месяц» не начинается раньше Москвы (СП-1). */
const PRESETS: { period: Exclude<SalesPeriodName, 'custom'>; label: string }[] = [
  { period: 'yesterday', label: 'admin.salesStats.period.yesterday' },
  { period: 'this_month', label: 'admin.salesStats.period.thisMonth' },
  { period: 'last_month', label: 'admin.salesStats.period.lastMonth' },
  { period: '7d', label: 'admin.salesStats.period.week' },
  { period: '30d', label: 'admin.salesStats.period.month' },
  { period: '90d', label: 'admin.salesStats.period.quarter' },
  { period: 'all', label: 'admin.salesStats.period.all' },
];

/** Поле даты высотой 44 px, как кнопки периода (ревью C4-14). */
const DATE_FIELD_CLASS =
  'flex min-h-[44px] min-w-[8rem] items-center justify-start gap-2 whitespace-nowrap rounded-lg border border-dark-600 bg-dark-800 px-3 py-1.5 text-sm text-dark-200 transition-colors hover:border-dark-500';

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const { t } = useTranslation();
  const isCustom = value.period === 'custom';
  // будущие дни не выбираются: окно всё равно кончается «сейчас», а подпись показала бы завтрашнюю дату (ревью C1-8)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

  const buttonClass = (active: boolean) =>
    `min-h-[44px] rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'bg-accent-500/20 text-accent-400'
        : 'bg-dark-800/50 text-dark-400 hover:bg-dark-700/50 hover:text-dark-300'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.period}
          type="button"
          onClick={() => onChange({ period: preset.period })}
          className={buttonClass(value.period === preset.period)}
        >
          {t(preset.label)}
        </button>
      ))}

      <button
        type="button"
        onClick={() =>
          onChange({ period: 'custom', start_date: value.start_date, end_date: value.end_date })
        }
        className={buttonClass(isCustom)}
      >
        {t('admin.salesStats.period.custom')}
      </button>

      {isCustom && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <DateField
            value={value.start_date || ''}
            onChange={(v) => onChange({ ...value, start_date: v })}
            max={value.end_date || today}
            placeholder={t('admin.salesStats.period.from')}
            className={DATE_FIELD_CLASS}
          />
          <span className="text-dark-500">{'—'}</span>
          <DateField
            value={value.end_date || ''}
            onChange={(v) => onChange({ ...value, end_date: v })}
            min={value.start_date}
            max={today}
            placeholder={t('admin.salesStats.period.to')}
            className={DATE_FIELD_CLASS}
          />
        </div>
      )}
    </div>
  );
}
