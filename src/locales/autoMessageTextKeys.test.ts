import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 Заведён этапом АС-10. Блок «Текст письма» — единственное место, где владелец
 * видит, что бот пишет клиентам сам. Тесты экрана мокают `t` как `key => key`, то
 * есть остаются зелёными ровно тогда, когда подпись пропала: класс «потеряли текст
 * подписи» в кабинете не сторожится ничем, кроме таких файлов (урок РЕК-8).
 *
 * Сторож читает сами словари.
 */

// fileURLToPath, а не url.pathname: в пути проекта кириллица (урок РЕК-1).
const HERE = dirname(fileURLToPath(import.meta.url));

const KEYS = [
  'text',
  'textBraces',
  'textSharesWith',
  'textSuffix',
  'textInserts',
  'textVariantWhen',
  'textEdit',
  'textEditHint',
  'textEdited',
  'textSave',
  'textCancel',
  'textReset',
  'textResetAsk',
  'textCounter',
  'textTooLong',
  'textNoLogo',
  'textMarkers',
  'textMarkerExample',
  'textRussianOnly',
];

function detailNode(lang: string): Record<string, unknown> {
  const dictionary = JSON.parse(readFileSync(join(HERE, `${lang}.json`), 'utf8'));
  return dictionary.admin.autoMessages.detail;
}

describe('подписи блока «Текст письма» на месте', () => {
  it.each(['ru', 'en'])('в словаре %s есть все подписи и они не пустые', (lang) => {
    const node = detailNode(lang);
    for (const key of KEYS) {
      const value = node[key];
      expect(typeof value, `${lang}: ${key} отсутствует`).toBe('string');
      expect(String(value).trim().length, `${lang}: ${key} пустая`).toBeGreaterThan(3);
      // Подпись, совпавшая с именем ключа, — это ровно тот сырой ключ на экране,
      // который тесты компонента принимают за успех.
      expect(String(value), `${lang}: ${key} — это имя ключа, а не текст`).not.toContain(
        'admin.autoMessages',
      );
    }
  });

  it.each(['ru', 'en'])('в словаре %s подстановка имени близнеца не потеряна', (lang) => {
    // Без {{other}} строка превращается в «тот же текст уходит в письме» без имени —
    // владелец не узнает, КАКОЕ второе письмо он читает.
    expect(String(detailNode(lang).textSharesWith)).toContain('{{other}}');
  });

  it('подписи русского и английского словарей — разные строки, а не копия', () => {
    const ru = detailNode('ru');
    const en = detailNode('en');
    for (const key of KEYS) {
      expect(ru[key], `${key}: английская подпись скопирована из русской`).not.toBe(en[key]);
    }
  });
});
