/**
 * РЕК-8б: строка под кнопкой доплаты объясняет АРИФМЕТИКУ и не утверждает списания.
 *
 * Первая редакция говорила «Ваши {{balance}} уже вычтены из {{total}}» — и это была ложь на
 * денежном экране: ничего не вычтено, деньги на счету лежат нетронутыми, а если человек нажмёт
 * карту, так и останутся. Ровно это описывает мина DE, и от неё на том же экране стоит сторож
 * `deviceFirst.paymentMethodsAvailable` — «деньги с баланса при этом не спишутся». Две строки
 * начали спорить друг с другом во всех четырёх языках сразу.
 *
 * 🔴 ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ПРОВЕРКА В ТЕСТАХ ЭКРАНА. Мутационный скептик волны 2 вернул
 * P0-формулировку прямо в `ru.json` — и все 95 тестов экрана остались зелёными: `react-i18next`
 * там замокан по ключу и реальные локали не читает НИКОГДА. То есть починка текста была
 * защищена ровно ничем. Этот файл читает сами JSON.
 *
 * ⚠️ Граница: сторож проверяет не «фраза хороша», а «фраза не утверждает совершённого
 * списания» — по списку глаголов, которыми это утверждение выражается в каждом языке. Новую
 * ложь другими словами он не поймает; это цена любого текстового забора, и она названа.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Каталог читается, а не перечисляется поимённо: пятая локаль иначе прошла бы мимо забора.
// `fileURLToPath`, а не `.pathname` — в пути проекта кириллица.
const LOCALES_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'));

// i18next допускает пробелы внутри скобок — ловим регуляркой, а не сравнением строк.
const BALANCE_PLACEHOLDER = /\{\{\s*balance\s*\}\}/;
const TOTAL_PLACEHOLDER = /\{\{\s*total\s*\}\}/;

// Глаголы, которыми утверждается СОВЕРШЁННОЕ списание. Ровно они и стояли в снятой редакции:
// ru «вычтены», en «deducted», fa «کسر شده», zh «扣除».
const CLAIMS_A_COMPLETED_DEBIT = ['вычтен', 'списан', 'deducted', 'charged', 'کسر شده', '扣除'];

describe('РЕК-8б: строка про доплату не обещает списания', () => {
  it.each(LOCALE_FILES)('%s объясняет арифметику двумя числами', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const phrase: string | undefined = dict?.deviceFirst?.topUpBalanceApplied;

    expect(phrase, `${file}: ключа deviceFirst.topUpBalanceApplied нет`).toBeTypeOf('string');
    // Оба числа обязаны доехать: без них строка объясняет не арифметику, а ничего.
    expect(phrase).toMatch(BALANCE_PLACEHOLDER);
    expect(phrase).toMatch(TOTAL_PLACEHOLDER);
  });

  it.each(LOCALE_FILES)('%s не утверждает, что деньги уже списаны', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const phrase: string = dict?.deviceFirst?.topUpBalanceApplied ?? '';

    for (const verb of CLAIMS_A_COMPLETED_DEBIT) {
      expect(
        phrase.toLowerCase().includes(verb.toLowerCase()),
        `${file}: «${verb}» утверждает списание, которого не было — см. мину DE`,
      ).toBe(false);
    }
  });

  // 🔴 Второй сторож того же класса: объяснение остановки автозапуска обязано существовать во
  // всех трёх редакциях. Одна на все случаи врала при полном балансе — там на экране ровно одна
  // кнопка «Списать и оформить», а текст предлагал выбрать из двух, которых нет.
  it.each(LOCALE_FILES)('%s разводит объяснение остановки на три случая', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    for (const key of [
      'autostartHeldTitle',
      'autostartHeldText',
      'autostartHeldCoveredText',
      'autostartHeldNoTopUpText',
    ]) {
      expect(dict?.deviceFirst?.[key], `${file}: нет ключа deviceFirst.${key}`).toBeTypeOf(
        'string',
      );
    }
  });
});
