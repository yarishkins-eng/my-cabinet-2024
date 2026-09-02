import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 Заведён этапом УБ-1 после того, как машинная чистка словарей снесла живой ключ
 * `admin.users.detail.subscription.saved` — тот, которым подписан тост после любого
 * действия с подпиской в карточке пользователя. Клиенты этого не видят, но владелец
 * работает здесь каждый день, и вместо тоста он получил бы сырое имя ключа.
 *
 * Поймать это было нечем: тесты карточки мокают `t` как `key => key` и ЖДУТ сырой
 * ключ — они остаются зелёными ровно тогда, когда подпись пропала.
 *
 * Сторож читает сами файлы и проверяет, что каждый ключ, который карточка спрашивает
 * литералом, в русском словаре есть. Русский — язык отката (`fallbackLng: 'ru'`),
 * поэтому потеря именно в нём означает сырой ключ на экране на всех языках.
 *
 * ⚠️ Паритет ВСЕХ ключей между языками здесь не проверяется намеренно: словари
 * кабинета сегодня расходятся на сотни ключей (en −630, fa −1150, zh −1154), это
 * отдельная работа, и сторож, падающий с первого дня, никого не защищает.
 */

// fileURLToPath, а не url.pathname: в пути проекта кириллица (урок РЕК-1).
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

const WATCHED = [
  join(SRC, 'pages', 'AdminUserDetail.tsx'),
  ...readdirSync(join(SRC, 'components', 'admin', 'userDetail'))
    .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
    .map((name) => join(SRC, 'components', 'admin', 'userDetail', name)),
];

const KEY_CALL = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;

function ru(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(HERE, 'ru.json'), 'utf8'));
}

function lookup(path: string): unknown {
  let node: unknown = ru();
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe('подписи карточки пользователя не теряются', () => {
  it('сторож видит сами файлы, а не пустой список', () => {
    expect(WATCHED.length).toBeGreaterThanOrEqual(6);
    const total = WATCHED.reduce(
      (sum, file) => sum + [...readFileSync(file, 'utf8').matchAll(KEY_CALL)].length,
      0,
    );
    expect(total, 'ключей собрано подозрительно мало — сборщик сломался').toBeGreaterThan(100);
  });

  it.each(WATCHED.map((file) => [file.split('/').pop() as string, file]))(
    '%s: каждый спрошенный ключ есть в ru.json',
    (_name, file) => {
      const missing = [...readFileSync(file, 'utf8').matchAll(KEY_CALL)]
        .map((match) => match[1])
        .filter((key) => typeof lookup(key) !== 'string');

      expect([...new Set(missing)], 'экран покажет сырое имя ключа вместо подписи').toEqual([]);
    },
  );

  it('ключ, снесённый этапом УБ-1, на месте во всех языках', () => {
    const langs = readdirSync(HERE)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace('.json', ''));
    for (const lang of langs) {
      const data = JSON.parse(readFileSync(join(HERE, `${lang}.json`), 'utf8'));
      expect(
        typeof data.admin?.users?.detail?.subscription?.saved,
        `${lang}: подпись после действия с подпиской снова пропала`,
      ).toBe('string');
    }
  });
});
