export function formatMoscowDate(
  value: string | null | undefined,
  language = 'ru',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const english = language.startsWith('en');
  const display = !english
    ? options
    : options.dateStyle || options.timeStyle
      ? { ...options, dateStyle: 'short' as const }
      : {
          ...options,
          day: '2-digit' as const,
          month: '2-digit' as const,
          year: 'numeric' as const,
        };
  const text = date.toLocaleString(english ? 'ru-RU' : language, {
    ...display,
    timeZone: 'Europe/Moscow',
  });
  return `${text.replace(/\s*г\.$/u, '')} (${language.startsWith('ru') ? 'МСК' : 'MSK'})`;
}
