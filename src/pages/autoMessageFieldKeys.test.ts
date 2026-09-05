import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Сторож ключей словаря для настраиваемых полей автосообщений.
 *
 * Тесты экранов подменяют переводчик на `key => key`, поэтому пропавший ключ они
 * не ловят: подпись поля просто станет пустой строкой, и владелец увидит число
 * без имени. Этот файл читает сами словари, а не рендер.
 *
 * `fileURLToPath`, а не `new URL(...).pathname`: в пути проекта есть кириллица,
 * иначе получаем percent-encoded строку и `readFileSync` не находит файл.
 */

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'locales');

const readLocale = (name: string) =>
  JSON.parse(readFileSync(join(localesDir, name), 'utf-8')) as Record<string, never>;

const detailKeys = (locale: Record<string, never>): Record<string, string> => {
  const admin = locale.admin as unknown as Record<string, unknown>;
  const section = admin?.autoMessages as Record<string, unknown> | undefined;
  return (section?.detail ?? {}) as Record<string, string>;
};

/** Имена полей и их ключи — держим списком здесь же, чтобы сторож не зависел от импорта .tsx. */
const FIELD_KEYS: Array<[string, string, string]> = [
  ['warn_hours', 'warnHours', 'warnHoursHint'],
  ['discount_percent', 'percent', 'percentHint'],
  ['valid_hours', 'hours', 'hoursHint'],
  ['trigger_days', 'days', 'daysHint'],
  ['not_connected_after_hours', 'notConnectedHours', 'notConnectedHoursHint'],
];

describe('ключи словаря для полей автосообщений', () => {
  for (const localeName of ['ru.json', 'en.json']) {
    it(`${localeName}: у каждого поля есть подпись и пояснение`, () => {
      const keys = detailKeys(readLocale(localeName));

      for (const [field, label, hint] of FIELD_KEYS) {
        expect(keys[label], `${field}: нет подписи ${label}`).toBeTruthy();
        expect(keys[hint], `${field}: нет пояснения ${hint}`).toBeTruthy();
      }
    });
  }

  it('пояснение нового поля не скопировано у соседа', () => {
    const keys = detailKeys(readLocale('ru.json'));

    // У соседа окно ограничено с двух сторон, поэтому там «меньше двух часов нельзя».
    // Здесь окно одностороннее, и это обоснование было бы ложью.
    expect(keys.notConnectedHoursHint).not.toContain('Меньше двух часов');
    expect(keys.notConnectedHoursHint).toContain('пробный');
  });
});
