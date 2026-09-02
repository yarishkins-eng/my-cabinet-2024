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
      // 🔴 РЕК-16.1: строка-оговорка и подпись свёртки живут только здесь. Тесты экрана
      // мокают `t` по ключу и пропажу текста не видят — они ЖДУТ сырой ключ.
      'payFullAmountNotice',
      'otherMethods',
    ]) {
      expect(dict?.deviceFirst?.[key], `${file}: нет ключа deviceFirst.${key}`).toBeTypeOf(
        'string',
      );
    }
  });
});

/**
 * РЕК-14.2: подстрочник под балансом называет доплату ВНУТРИ числа, а не рядом с ним.
 *
 * 🔴 Зачем сторож. Строка денежная и живёт в четырёх языках, а тесты экранов мокают
 * `react-i18next` по ключу и настоящие локали не читают никогда — то есть текст был бы
 * защищён ровно ничем, как это уже случилось с формулировкой РЕК-8б выше.
 *
 * ⛔ Чего строка не смеет делать, и почему именно это:
 *  · нести знак «плюс» или слово «прибавлено» — доплата УЖЕ внутри баланса, а «+199» рядом
 *    с «249» человек читает как слагаемое и ждёт сдачи. Нашла линза UX на разборе замысла;
 *  · называть происхождение денег («подарок», «бонус») — экран его не знает: на балансе
 *    может лежать сдача, возврат или собственное пополнение.
 *
 * ⚠️ Граница честно: сторож ловит перечисленные формы, а не «смысл». Новую ложь другими
 * словами он не поймает — это цена любого текстового забора.
 */
const AMOUNT_PLACEHOLDER = /\{\{\s*amount\s*\}\}/;
const CLAIMS_AN_ADDITION = ['+', 'прибавлен', 'added on top', 'плюс'];
const NAMES_THE_ORIGIN = ['подарок', 'подарочн', 'бонус', 'gift', 'bonus', 'هدیه', '赠送'];

describe('РЕК-14.2: подстрочник о доплате не обещает прибавки к балансу', () => {
  it.each(LOCALE_FILES)('%s называет доплату включённой в баланс', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const phrase: string | undefined = dict?.deviceFirst?.balanceIncludesTopUp;

    expect(phrase, `${file}: ключа deviceFirst.balanceIncludesTopUp нет`).toBeTypeOf('string');
    expect(phrase).toMatch(AMOUNT_PLACEHOLDER);
    for (const claim of CLAIMS_AN_ADDITION) {
      expect(
        phrase!.toLowerCase().includes(claim),
        `${file}: строка выглядит как прибавка к балансу («${claim}»), а доплата уже внутри него`,
      ).toBe(false);
    }
    for (const origin of NAMES_THE_ORIGIN) {
      expect(
        phrase!.toLowerCase().includes(origin),
        `${file}: строка называет происхождение денег («${origin}»), а экран его не знает`,
      ).toBe(false);
    }
  });
});

/**
 * РЕК-16: экран называет способ, который человек выбрал, — и не обещает списания.
 *
 * 🔴 Решение владельца 02.09.2026, дословно: «правильно делать так как выбрал клиент, а не
 * так — клиент выбрал, а мы ему другое подкидываем». В ветке «денег на счету хватает на всё»
 * мы его выбор всё-таки подменяем: он нажал способ оплаты, а экран показывает одну кнопку
 * «Списать … и оформить». Кнопки его способа там нет намеренно — она и есть заслон от второго
 * платежа за ту же подписку. Раз подменяем, обязаны сказать об этом и НАЗВАТЬ выбранное по
 * имени: без подстановки строка снова становится немой, и решение владельца не исполнено.
 *
 * ⚠️ Граница названа честно: «заголовок говорит о человеке, а не о нас» тестом НЕ закрыт.
 * Забор на слова снятой редакции («мы не открыли оплату») стерёг бы букву прошлой поломки —
 * ровно та ошибка, которую этот проект уже делал 30.08. Свойство «фраза не про нас»
 * подстрокой не выражается, поэтому оно остаётся на глазах ревью, а не на тесте.
 */
const METHOD_PLACEHOLDER = /\{\{\s*method\s*\}\}/;

describe('РЕК-16: подмена выбора названа по имени', () => {
  it.each(LOCALE_FILES)('%s называет выбранный способ в объяснении при полном балансе', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const phrase: string | undefined = dict?.deviceFirst?.autostartHeldCoveredText;

    expect(phrase, `${file}: ключа deviceFirst.autostartHeldCoveredText нет`).toBeTypeOf('string');
    expect(
      METHOD_PLACEHOLDER.test(phrase!),
      `${file}: строка не называет выбранный способ — подмена снова молчаливая`,
    ).toBe(true);
  });

  it.each(LOCALE_FILES)('%s не утверждает списания в строке про полную оплату', (file) => {
    const dict = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const phrase: string = dict?.deviceFirst?.payFullAmountNotice ?? '';

    for (const verb of CLAIMS_A_COMPLETED_DEBIT) {
      expect(
        phrase.toLowerCase().includes(verb.toLowerCase()),
        `${file}: «${verb}» утверждает списание, которого не было — см. мину DE`,
      ).toBe(false);
    }
  });
});
