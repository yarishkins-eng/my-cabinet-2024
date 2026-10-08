/**
 * ВК-16 (16в). Тексты доплаты под заказ — сторож по САМИМ файлам локалей.
 *
 * Тесты экранов мокают `t` и видят только ключи: пропавший ключ в одной из локалей показал бы человеку сырое
 * `balance.topUpResult.intent.reasons.price_changed`, и ни один тест экрана этого бы не заметил (урок РЕК-8, УБ-1).
 * Здесь: у каждой локали есть каждый ключ, причины отказа — ровно закрытый набор бота, подстановки на месте, и
 * «оформится само» не обещает ничего, кроме того, что сделает сервер.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'));

// Закрытый набор причин бота (`TOPUP_INTENT_REFUSAL_REASONS`, `device_first_checkout_service.py`) — ЛИТЕРАЛОМ.
const BOT_REASONS = [
  'open_order',
  'order_on_review',
  'price_changed',
  'balance_short',
  'restricted',
  'account_erasure',
  'unavailable',
  'expired',
  'replaced',
  'cancelled',
  'disabled',
  'already_purchased',
  'subscription_changed',
  'technical_error',
];

const RESULT_KEYS = [
  'waitingTitle',
  'processingTitle',
  'waitingDesc',
  'processingDesc',
  'checkingTitle',
  'checkingDesc',
  'delayedTitle',
  'delayedDesc',
  'checkAgain',
  'readyTitle',
  'readyDesc',
  'openOrder',
  'notPlacedTitle',
  'boughtTitle',
  'moneyOnBalance',
  'offer',
  'choosePeriod',
  'chooseOtherPeriod',
  'toMyOrder',
  'writeSupport',
  'closedTitle',
  'closedNoMoney',
];

const load = (file: string) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));

describe('ВК-16 · 16в-2: тексты экрана ожидания заказа', () => {
  it('локалей четыре — новая не пройдёт мимо', () => {
    expect(LOCALE_FILES.sort()).toEqual(['en.json', 'fa.json', 'ru.json', 'zh.json']);
  });

  it.each(LOCALE_FILES)('%s: каждый ключ на месте и не пустой', (file) => {
    const intent = load(file).balance.topUpResult.intent;
    for (const key of RESULT_KEYS) {
      expect(typeof intent[key], `${file}: ${key}`).toBe('string');
      expect(intent[key].trim().length, `${file}: ${key}`).toBeGreaterThan(0);
    }
  });

  it.each(LOCALE_FILES)('%s: причины — ровно закрытый набор бота', (file) => {
    const reasons = load(file).balance.topUpResult.intent.reasons;
    expect(Object.keys(reasons).sort()).toEqual([...BOT_REASONS].sort());
    for (const reason of BOT_REASONS) expect(reasons[reason].trim().length).toBeGreaterThan(0);
  });

  it.each(LOCALE_FILES)('%s: «Оформить» несёт и заказ, и цену', (file) => {
    const offer: string = load(file).balance.topUpResult.intent.offer;
    expect(offer).toMatch(/\{\{\s*what\s*\}\}/);
    expect(offer).toMatch(/\{\{\s*price\s*\}\}/);
  });
});

const ORDER_KEYS = [
  'title',
  'price',
  'fromBalance',
  'toPay',
  'preparing',
  'pay',
  'autoPromise',
  'alreadyPaying',
  'otherMethodHint',
  'ordinary',
  'openOrder',
  'toMyOrder',
  'onReview',
  'writeSupport',
  'fulfilledWhat',
  'fulfilledRecent',
  'fulfilledUntil',
  'morePeriodQuestion',
  'morePeriodQuestionNoPrice',
  'morePeriodYes',
  'morePeriodNo',
  'balanceCovers',
  'backToOrder',
  'changeOrder',
  'confirmRejected',
];

// Чужие ключи, которые берёт «Оплата заказа» и экран ожидания: пропади хоть один — человек увидит сырой ключ.
const BORROWED = [
  ['deviceFirst', 'errorProviderNoInvoice'],
  ['deviceFirst', 'periodYear'],
  ['deviceFirst', 'periodMonths'],
  ['deviceFirst', 'periodDays'],
  ['deviceFirst', 'deviceShort'],
  ['balance', 'paymentMethod'],
  ['balance', 'openPaymentPage'],
  ['common', 'retry'],
  ['common', 'error'],
];

describe('ВК-16 · 16в-1: тексты экрана «Оплата заказа»', () => {
  it.each(LOCALE_FILES)('%s: каждый ключ на месте и не пустой', (file) => {
    const dict = load(file);
    const order = dict.balance.topUpOrder;
    for (const key of ORDER_KEYS) {
      expect(typeof order[key], `${file}: ${key}`).toBe('string');
      expect(order[key].trim().length, `${file}: ${key}`).toBeGreaterThan(0);
    }
    for (const [group, key] of BORROWED) {
      expect(typeof dict[group][key], `${file}: ${group}.${key}`).toBe('string');
    }
  });

  it.each(LOCALE_FILES)('%s: подстановки на месте', (file) => {
    const order = load(file).balance.topUpOrder;
    expect(order.pay).toMatch(/\{\{\s*amount\s*\}\}/);
    expect(order.fulfilledWhat).toMatch(/\{\{\s*what\s*\}\}/);
    expect(order.fulfilledUntil).toMatch(/\{\{\s*date\s*\}\}/);
    expect(order.morePeriodQuestion).toMatch(/\{\{\s*what\s*\}\}/);
    expect(order.morePeriodQuestion).toMatch(/\{\{\s*price\s*\}\}/);
    expect(order.morePeriodQuestionNoPrice).toMatch(/\{\{\s*what\s*\}\}/);
  });

  // Русская подпись обещания — дословно та, что согласована в стартере («даже если вы закроете это окно»).
  it('ru: обещание говорит, что оформится само, и только после подтверждения банка', () => {
    const order = load('ru.json').balance.topUpOrder;
    expect(order.autoPromise).toContain('оформится сама');
    expect(order.autoPromise).toContain('банк подтвердит');
    expect(order.ordinary).not.toContain('оформится');
  });
});
