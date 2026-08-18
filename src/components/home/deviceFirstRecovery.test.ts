import { describe, expect, it } from 'vitest';
import {
  deviceFirstRecoveryVariant,
  isMoneyInFlightRecovery,
  isNoOpenCheckoutError,
  shouldHideRecoveryCard,
} from './deviceFirstRecovery';

describe('deviceFirstRecoveryVariant', () => {
  it('maps operator_review to operator', () => {
    expect(deviceFirstRecoveryVariant('operator_review')).toBe('operator');
  });

  it('maps awaiting_payment to awaiting_payment', () => {
    expect(deviceFirstRecoveryVariant('awaiting_payment')).toBe('awaiting_payment');
  });

  it('maps pre-payment browsing states to draft', () => {
    expect(deviceFirstRecoveryVariant('configuration')).toBe('draft');
    expect(deviceFirstRecoveryVariant('confirmation')).toBe('draft');
  });

  it('maps provisioning states to processing', () => {
    expect(deviceFirstRecoveryVariant('processing')).toBe('processing');
    expect(deviceFirstRecoveryVariant('provisioning')).toBe('processing');
  });

  it('treats unknown states as processing (safe: card stays visible)', () => {
    expect(deviceFirstRecoveryVariant('something_new')).toBe('processing');
  });
});

describe('shouldHideRecoveryCard', () => {
  it('hides a browsing draft while the trial offer is on screen', () => {
    expect(shouldHideRecoveryCard('draft', true)).toBe(true);
  });

  it('keeps the draft when no trial offer competes with it', () => {
    expect(shouldHideRecoveryCard('draft', false)).toBe(false);
  });

  it('never hides states with money or provisioning in flight', () => {
    expect(shouldHideRecoveryCard('awaiting_payment', true)).toBe(false);
    expect(shouldHideRecoveryCard('operator', true)).toBe(false);
    expect(shouldHideRecoveryCard('processing', true)).toBe(false);
  });
});

describe('isMoneyInFlightRecovery', () => {
  it('flags states where the trial block must stay off', () => {
    expect(isMoneyInFlightRecovery('processing')).toBe(true);
    expect(isMoneyInFlightRecovery('operator')).toBe(true);
  });

  it('allows the trial block for browsing and unpaid-invoice states', () => {
    expect(isMoneyInFlightRecovery('draft')).toBe(false);
    expect(isMoneyInFlightRecovery('awaiting_payment')).toBe(false);
    expect(isMoneyInFlightRecovery(null)).toBe(false);
  });
});

describe('isNoOpenCheckoutError', () => {
  // 🔴 Пункт 4.11б. Отличать «заказа нет» надо строго по каноническому коду. Форма ответа
  // зашита литералом нарочно: сторож не должен ходить по той же константе, что и код.
  it('recognises the canonical answer that no order is open', () => {
    expect(
      isNoOpenCheckoutError({ response: { data: { detail: { code: 'no_open_checkout' } } } }),
    ).toBe(true);
  });

  it('recognises it without a message field, exactly as the server sends it', () => {
    // Сервер шлёт `{"detail": {"code": "no_open_checkout"}}` без `message`
    // (`bot-code/app/cabinet/routes/device_first.py:397`). Требовать `message` нельзя.
    const asServerSendsIt = JSON.parse(
      '{"response":{"data":{"detail":{"code":"no_open_checkout"}}}}',
    );
    expect(isNoOpenCheckoutError(asServerSendsIt)).toBe(true);
  });

  it('does not swallow a 404 whose detail is a plain string', () => {
    // Тем же статусом 404 отвечает проверка пользователя, и `detail` там строка
    // (`bot-code/app/cabinet/dependencies.py:88-92`). Гасить карточку по статусу нельзя.
    expect(isNoOpenCheckoutError({ response: { data: { detail: 'User not found' } } })).toBe(false);
  });

  it('does not swallow other device-first codes', () => {
    expect(
      isNoOpenCheckoutError({ response: { data: { detail: { code: 'rate_limited' } } } }),
    ).toBe(false);
    expect(
      isNoOpenCheckoutError({ response: { data: { detail: { code: 'invoice_terminal' } } } }),
    ).toBe(false);
  });

  it('never treats a broken connection as an answer', () => {
    // 🔴 Самое важное: карточка — единственный вход к живому заказу с Главной. Обрыв связи,
    // 5xx и таймаут обязаны пробрасываться, иначе моргнувшая сеть спрячет чужие деньги.
    expect(isNoOpenCheckoutError(new Error('Network Error'))).toBe(false);
    expect(isNoOpenCheckoutError({ response: { status: 500, data: {} } })).toBe(false);
    expect(isNoOpenCheckoutError({ message: 'timeout of 15000ms exceeded' })).toBe(false);
    expect(isNoOpenCheckoutError(null)).toBe(false);
    expect(isNoOpenCheckoutError(undefined)).toBe(false);
  });
});
