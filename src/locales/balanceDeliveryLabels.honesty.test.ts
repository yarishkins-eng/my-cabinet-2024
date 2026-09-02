import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 Этап УБ-1. Тесты вкладки «Баланс» мокают `react-i18next` (`t: key => key`) —
 * настоящие словари в них не читаются НИКОГДА. Значит подписи исхода доставки там
 * защищены ровно ничем (урок РЕК-8). Этот сторож читает сами JSON.
 *
 * Проверяем не «ключ есть», а что подпись не врёт: «не доставлено» обязано говорить
 * про НЕудачу, иначе админ прочитает предупреждение как успех.
 */

// fileURLToPath, а не url.pathname: в пути проекта кириллица, и pathname приходит
// percent-encoded (урок РЕК-1).
const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));

const NEGATIVE_WORDS: Record<string, RegExp> = {
  ru: /не удалось|не получил|не доставлен/i,
  en: /could not|couldn't|not deliver|failed/i,
  fa: /ممکن نشد|نشد/,
  zh: /无法|未能/,
};

interface LocaleFile {
  admin: { users: { detail: { balance: Record<string, string> } } };
}

function balanceNode(lang: string): Record<string, string> {
  const data = JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf8')) as LocaleFile;
  return data.admin.users.detail.balance;
}

// Каталог перебираем, а не перечисляем поимённо: появится пятый язык — сторож
// увидит его сам, а не промолчит.
const LANGS = readdirSync(LOCALES_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace('.json', ''));

describe('подписи исхода доставки на вкладке «Баланс»', () => {
  it('сторож видит все языки проекта', () => {
    expect(LANGS.length).toBeGreaterThanOrEqual(4);
    expect(LANGS).toContain('ru');
  });

  it.each(LANGS)('%s: все три подписи на месте и непустые', (lang) => {
    const node = balanceNode(lang);
    for (const key of ['saved', 'delivered', 'notDelivered']) {
      expect(typeof node[key], `${lang}.${key}`).toBe('string');
      expect(node[key].trim().length, `${lang}.${key} пустой`).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)('%s: «не доставлено» говорит именно о неудаче', (lang) => {
    const node = balanceNode(lang);
    const negative = NEGATIVE_WORDS[lang];
    expect(negative, `для языка ${lang} не задано слово отказа — допишите его сюда`).toBeDefined();
    expect(
      negative.test(node.notDelivered),
      `${lang}: подпись «${node.notDelivered}» не говорит, что сообщение НЕ дошло`,
    ).toBe(true);
  });

  it.each(LANGS)('%s: «дошло» и «не дошло» — разные строки', (lang) => {
    const node = balanceNode(lang);
    expect(node.delivered).not.toBe(node.notDelivered);
  });
});
