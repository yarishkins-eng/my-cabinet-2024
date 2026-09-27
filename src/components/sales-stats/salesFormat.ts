import { useTranslation } from 'react-i18next';

import { SALES_STATS } from '../../constants/salesStats';
import { useCurrency } from '../../hooks/useCurrency';

const MSK = 'Europe/Moscow';
/** Неразрывный пробел: «1 155 ₽» и «12 %» не рвутся на две строки на узком телефоне (ревью C4-13). */
const NBSP = ' ';
/** Окно короче суток (утро 1-го числа, «Свой период» за сегодня) — процент к прошлому окну не показываем: «↑ 700 %»
 * за несколько часов ничего не значит (ревью C4-10). Порог по сумме «меньше 1 000 ₽» прятал процент у «Вчера» в 12 днях
 * из 18 денежных дней сентября — это ежедневная сверка владельца (ревью S3-2). Сама сумма прошлого окна видна всегда. */
const MIN_PERCENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DASH = '—';
/** Пока числа грузятся — многоточие: прочерк значит «не посчиталось» (ревью C4-11). */
export const LOADING = '…';
export const LOCALES: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  zh: 'zh-CN',
  fa: 'fa-IR',
};

/** Деньги — целыми рублями с разрядами («16 157 ₽»), а не «16157» (ревью L3-6). */
export function useMoney() {
  const { i18n } = useTranslation();
  const { formatWithCurrency } = useCurrency();
  return (kopeks: number | null | undefined): string => {
    if (kopeks === null || kopeks === undefined) return DASH;
    const rubles = kopeks / SALES_STATS.KOPEKS_DIVISOR;
    if (i18n.language === 'ru') {
      return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(rubles)}${NBSP}₽`;
    }
    return formatWithCurrency(rubles, 0);
  };
}

export function useLocaleTag() {
  const { i18n } = useTranslation();
  return LOCALES[i18n.language] ?? 'en-GB';
}

/** «1–27 сентября», «26 сентября», «5 августа – 1 сентября»; если окно кончается не в полночь по Москве —
 * «… до 11:52» (сравнение идёт до того же часа, ревью W2-7). Год печатается, когда окно не в году `nowIso` или
 * пересекает Новый год (ревью C1-3, C6-6). */
export function formatMskRange(
  startIso: string,
  endIso: string,
  locale: string,
  /** Момент данных (`generated_at`): от него считается «этот год». */
  nowIso: string,
  /** Без него окно печатается без часа — для текущего окна час уже есть в «данные на». */
  until?: (time: string) => string,
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const lastMoment = new Date(Math.max(start.getTime(), end.getTime() - 1));
  const dayMonth = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: MSK,
  });
  const dayMonthYear = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: MSK,
  });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: MSK });
  const month = new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    year: 'numeric',
    timeZone: MSK,
  });
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MSK,
  });
  // год и полночь — по латинским цифрам: у fa-IR цифры персидские, «۰۰:۰۰» не равно «00:00» (ревью C1-10)
  const plain = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MSK,
  });
  const part = (date: Date, type: 'year' | 'hour' | 'minute') =>
    plain.formatToParts(date).find((item) => item.type === type)?.value;
  const crossesYear = part(start, 'year') !== part(lastMoment, 'year');
  const last = (
    crossesYear || part(lastMoment, 'year') !== part(new Date(nowIso), 'year')
      ? dayMonthYear
      : dayMonth
  ).format(lastMoment);
  const sameDay =
    dayMonth.format(start) === dayMonth.format(lastMoment) &&
    month.format(start) === month.format(lastMoment);
  const sameMonth = month.format(start) === month.format(lastMoment);
  let label: string;
  if (sameDay) label = last;
  else if (sameMonth && (locale === 'ru-RU' || locale === 'en-GB'))
    label = `${day.format(start)}–${last}`;
  else label = `${(crossesYear ? dayMonthYear : dayMonth).format(start)} – ${last}`;
  const endsAtMidnight = part(end, 'hour') === '00' && part(end, 'minute') === '00';
  return endsAtMidnight || end.getTime() <= start.getTime()
    ? label
    : until
      ? `${label} ${until(time.format(end))}`
      : label;
}

export function formatMskTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MSK,
  }).format(new Date(iso));
}

export function formatMskDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MSK,
  }).format(new Date(iso));
}

/** Процент к прошлому окну — только когда он честен: там были деньги, окно не раньше первых денег (сервер) и окно не
 * короче суток. */
export function percentChange(
  current: number,
  previous: number | null,
  comparable: boolean,
  windowMs: number,
): number | null {
  if (!comparable || previous === null || previous <= 0 || windowMs < MIN_PERCENT_WINDOW_MS)
    return null;
  const value = Math.round(((current - previous) / previous) * 100);
  // падение меньше 0,5 % округляется в «−0»: это ровный ноль без стрелки, а не «↑ 0 %» (ревью C1-11)
  return value === 0 ? 0 : value;
}

export function formatPercent(value: number, locale: string): string {
  return `${value.toLocaleString(locale)}${NBSP}%`;
}

/** «↑ 22 %», «↓ 5 %», «0 %». */
export function formatChange(change: number, locale: string): string {
  const arrow = change > 0 ? `↑${NBSP}` : change < 0 ? `↓${NBSP}` : '';
  return `${arrow}${formatPercent(Math.abs(change), locale)}`;
}
