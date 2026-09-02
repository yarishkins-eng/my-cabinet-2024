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
  ru: /не удалось|не получил|не доставлен|не ушл/i,
  en: /could not|couldn't|not deliver|not notified|failed/i,
  fa: /ممکن نشد|نشد|نرسید/,
  zh: /无法|未能/,
};

// Подпись обязана назвать ФАКТ и не угадывать причину: причин отказа девять
// (нет Телеграма и подтверждённой почты, человек заблокировал бота, мы заблокировали
// его, не поднят SMTP, сеть, flood control, наш потолок ожидания, пустой токен), и
// первая редакция называла две — обе как вину клиента. Владелец шёл писать человеку
// вручную там, где у нас просто моргнула сеть.
// Подпись одна на начисление и на списание, поэтому направление денег в ней называть
// нельзя: «Деньги зачислены» после СПИСАНИЯ — прямой повод списать второй раз.
const DIRECTION_WORDS: Record<string, RegExp> = {
  ru: /зачислен|пополнен|списан/i,
  en: /credited|topped up|debited/i,
  fa: /واریز|کسر/,
  zh: /入账|充值|扣除/,
};

const CAUSE_GUESSES: Record<string, RegExp> = {
  ru: /заблокировал|не пользуется/i,
  en: /blocked|does not use/i,
  fa: /مسدود/,
  zh: /屏蔽|未使用/,
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

  it.each(LANGS)('%s: «не доставлено» не называет направление денег', (lang) => {
    const node = balanceNode(lang);
    const direction = DIRECTION_WORDS[lang];
    expect(
      direction,
      `для языка ${lang} не задано слово направления — допишите его сюда`,
    ).toBeDefined();
    expect(
      direction.test(node.notDelivered),
      `${lang}: подпись «${node.notDelivered}» утверждает направление, а она одна на начисление и списание`,
    ).toBe(false);
  });

  it.each(LANGS)('%s: «не доставлено» не угадывает причину', (lang) => {
    const node = balanceNode(lang);
    const guess = CAUSE_GUESSES[lang];
    expect(guess, `для языка ${lang} не задано слово-догадка — допишите его сюда`).toBeDefined();
    expect(
      guess.test(node.notDelivered),
      `${lang}: подпись «${node.notDelivered}» называет причину, которой мы не знаем`,
    ).toBe(false);
  });

  it.each(LANGS)('%s: у счётчика массовой выдачи есть подпись', (lang) => {
    const data = JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf8')) as {
      admin: { bulkActions: Record<string, string> };
    };
    expect(typeof data.admin.bulkActions.notNotifiedCount).toBe('string');
  });

  it.each(LANGS)('%s: «дошло» и «не дошло» — разные строки', (lang) => {
    const node = balanceNode(lang);
    expect(node.delivered).not.toBe(node.notDelivered);
  });
});
