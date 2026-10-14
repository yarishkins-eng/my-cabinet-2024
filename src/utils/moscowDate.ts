export function formatMoscowDate(
  value: string | null | undefined,
  language = 'ru',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const text = date.toLocaleString(language, { ...options, timeZone: 'Europe/Moscow' });
  return `${text.replace(/\s*г\.$/u, '')} (${language.startsWith('ru') ? 'МСК' : 'MSK'})`;
}
