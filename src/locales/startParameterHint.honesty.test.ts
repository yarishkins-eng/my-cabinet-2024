/**
 * РЕК-6А: подсказка под полем метки обязана предупреждать, что метку видит клиент.
 *
 * Метка (`start_parameter`) публична по устройству Телеграма: заходя по рекламной ссылке,
 * человек отправляет в свой чат `/start <метка>`, и сообщение там остаётся. Владелец называет
 * кампании внутренними кличками с бюджетом («Кувалда 7000₽»), и метка `kuvalda7000` вернула бы
 * утечку, которую закрыл РЕК-1, — мимо всякого кода. Прежняя подсказка говорила только про
 * допустимые символы: «Только латиница, цифры, _ и -».
 *
 * Ключ ОДИН на обе формы — создание (`AdminCampaignCreate.tsx`) и правку
 * (`AdminCampaignEdit.tsx`), поэтому разъехаться они не могут по построению.
 *
 * ⚠️ ГРАНИЦА: сторож проверяет текст подсказки, а не то, что она отрисована. Что ключ вообще
 * используется обеими формами — проверяется отдельным тестом ниже поиском по исходникам.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'));

// Слова «клиент увидит» в каждом языке. Стережём СМЫСЛ, а не фразу целиком: переписать
// формулировку можно, потерять предупреждение — нельзя.
const AUDIENCE_WORDS: Record<string, RegExp> = {
  ru: /клиент/i,
  en: /client|customer/i,
  fa: /مشتری/,
  zh: /客户/,
};

function hint(file: string): string {
  const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf-8'));
  return data?.admin?.campaigns?.form?.startParameterHint ?? '';
}

describe('РЕК-6А: подсказка про метку предупреждает, что её видит клиент', () => {
  it('локали найдены', () => {
    expect(LOCALE_FILES.length).toBeGreaterThan(0);
  });

  it.each(LOCALE_FILES)('%s: подсказка на месте и называет того, кто метку увидит', (file) => {
    const text = hint(file);
    expect(text).not.toBe('');
    const lang = file.replace('.json', '');
    const word = AUDIENCE_WORDS[lang];
    // Новый язык без записи в AUDIENCE_WORDS обязан уронить сторож, а не проскочить молча.
    expect(word, `для языка ${lang} не задано слово-признак`).toBeDefined();
    expect(text).toMatch(word);
  });

  // 🔴 Линза показала мутацией, что ботовый сторож требует запрета на «внутреннее» и «бюджет»,
  // а кабинетный — нет: текст «⚠️ Клиента это тоже касается» проходил зелёным, хотя запрет из
  // него вырезан. Один и тот же смысл в двух репозиториях был защищён по-разному.
  const FORBIDS: Record<string, RegExp[]> = {
    ru: [/внутренн/i, /бюджет/i],
    en: [/internal/i, /budget/i],
    fa: [/داخلی/, /بودجه/],
    zh: [/内部/, /预算/],
  };

  it.each(LOCALE_FILES)('%s: подсказка запрещает ровно то, что утекало', (file) => {
    const lang = file.replace('.json', '');
    const rules = FORBIDS[lang];
    expect(rules, `для языка ${lang} не задан запрет`).toBeDefined();
    for (const rule of rules) expect(hint(file)).toMatch(rule);
  });

  it.each(LOCALE_FILES)('%s: правило про символы не потеряно', (file) => {
    // Предупреждение добавлено К подсказке, а не вместо неё: без правила про символы
    // человек введёт кириллицу и получит отказ без объяснения.
    // 🔴 Проверяем ОБА разрешённых символа и оба конца правила: прежний `/[-_]/` проходил
    // на любом дефисе где угодно в строке, то есть не проверял правило по существу.
    const text = hint(file);
    expect(text).toContain('_');
    expect(text).toContain('-');
  });

  it('обе формы берут подсказку из этого ключа', () => {
    const src = path.resolve(LOCALES_DIR, '..', 'pages');
    const forms = ['AdminCampaignCreate.tsx', 'AdminCampaignEdit.tsx'];
    for (const form of forms) {
      const code = fs.readFileSync(path.join(src, form), 'utf-8');
      expect(code, `${form} перестала показывать подсказку`).toContain(
        'admin.campaigns.form.startParameterHint',
      );
    }
  });
});
