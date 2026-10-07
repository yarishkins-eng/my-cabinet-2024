import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ВК-4 (АП-0). Тесты экранов мокают `t` как `key => key` и остаются зелёными ровно тогда, когда
 * подпись пропала из словаря: на экране вместо слов встал бы сырой ключ. Сторож читает сами словари.
 */

// fileURLToPath, а не url.pathname: в пути проекта кириллица (урок РЕК-1).
const HERE = dirname(fileURLToPath(import.meta.url));

const SETTINGS_KEYS = [
  'badgeServer',
  'lockedOnServer',
  'saveFailed',
  'resetFailed',
  'serverLockedHint',
];

function dictionary(lang: string): Record<string, any> {
  return JSON.parse(readFileSync(join(HERE, `${lang}.json`), 'utf8')) as Record<string, any>;
}

describe('ВК-4: подписи замка «задано на сервере» и раздела «Автосообщения» на месте', () => {
  it.each(['ru', 'en', 'fa', 'zh'])('%s: подписи замка и отказа сохранения', (lang) => {
    const node = dictionary(lang).admin.settings;
    for (const key of SETTINGS_KEYS) {
      expect(typeof node[key], `${lang}: ${key} отсутствует`).toBe('string');
      expect(String(node[key]).trim().length, `${lang}: ${key} пустая`).toBeGreaterThan(3);
    }
  });

  it.each(['ru', 'en'])('%s: две разные подписи истории без счёта', (lang) => {
    const node = dictionary(lang).admin.autoMessages.history;
    expect(typeof node.notCounted).toBe('string');
    expect(typeof node.notCountedQuiet).toBe('string');
    expect(node.notCountedQuiet).not.toBe(node.notCounted);
  });

  it('ru: отказ называет причину — сервер, а фраза охвата — письма панели', () => {
    const ru = dictionary('ru').admin;
    expect(ru.settings.lockedOnServer).toMatch(/сервер/);
    expect(ru.autoMessages.scope).toMatch(/панел/);
  });
});
