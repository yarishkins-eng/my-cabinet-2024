import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * РЕФ-1.2 (19.09.2026): виджет в «Профиле» показывает ОДНУ ссылку (на бота), поэтому у него
 * свой заголовок в единственном числе. Тесты экранов мокают `t` как «ключ → ключ» и пропажу
 * ключа не заметят — человек увидел бы `referral.yourLinkSingle` вместо текста. Каталог
 * перебирается, а не перечисляется: новый словарь без ключа тоже должен покраснеть.
 */
const localesDir = join(process.cwd(), 'src', 'locales');
const files = readdirSync(localesDir).filter((name) => name.endsWith('.json'));

describe('заголовок реферальной ссылки в «Профиле»', () => {
  it('в каталоге есть словари', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s: referral.yourLinkSingle есть и не пуст', (file) => {
    const dictionary = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as {
      referral?: Record<string, unknown>;
    };
    const value = dictionary.referral?.yourLinkSingle;
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('по-русски — единственное число, а не «ссылки»', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as {
      referral: Record<string, string>;
    };
    expect(ru.referral.yourLinkSingle).toBe('Ваша реферальная ссылка');
    expect(ru.referral.yourLink).not.toBe(ru.referral.yourLinkSingle);
  });
});
