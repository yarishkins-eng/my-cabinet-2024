// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { clearTopUpPendingInfo, loadTopUpPendingInfo, saveTopUpPendingInfo } from './topUpStorage';

// 🔴 Этап В-1. Эта запись — единственное, что помнит, КУДА вернуть человека после банка.
// Возврат кнопкой платёжной системы перезапускает мини-приложение: строки браузера в этот
// момент нет, а `sessionStorage` умирает вместе с прежним запуском. Отсюда два свойства,
// которые обязаны быть закрыты сторожем: запись переживает перезапуск и несёт адрес возврата.

const KEY = 'topup_pending_payment';
const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=90&devices=5';

function info(returnTo: string | null) {
  return {
    amount_kopeks: 6000,
    method_id: 'platega',
    method_name: 'Platega',
    payment_id: '4242',
    created_at: Date.now(),
    return_to: returnTo,
  };
}

describe('topUpStorage — память о начатом пополнении', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('переживает перезапуск мини-приложения вместе с адресом возврата', () => {
    saveTopUpPendingInfo(info(CHECKOUT_RETURN));

    // Перезапуск: Телеграм открывает приложение заново, сессионное хранилище чистое.
    sessionStorage.clear();

    expect(loadTopUpPendingInfo()?.return_to).toBe(CHECKOUT_RETURN);
  });

  // 🔴 Второй конец шкалы: проверка «пережила» одна прошла бы и у кода, который никогда
  // ничего не стирает. Гашение на исходе платежа обязано убирать запись ОБОИХ хранилищ.
  it('гашение убирает запись и из старого места тоже', () => {
    saveTopUpPendingInfo(info(CHECKOUT_RETURN));
    sessionStorage.setItem(KEY, JSON.stringify(info(CHECKOUT_RETURN)));

    clearTopUpPendingInfo();

    expect(loadTopUpPendingInfo()).toBeNull();
  });

  // Человек, начавший пополнение за минуту до выкладки, держит запись в старом месте.
  // Потерять её — значит сбросить его на баланс с экрана результата.
  it('читает запись, оставшуюся от прежней сборки в старом месте', () => {
    sessionStorage.setItem(KEY, JSON.stringify(info(CHECKOUT_RETURN)));

    expect(loadTopUpPendingInfo()?.payment_id).toBe('4242');
  });

  it('запись без адреса возврата — это обычное пополнение, а не поломка', () => {
    saveTopUpPendingInfo(info(null));

    const loaded = loadTopUpPendingInfo();
    expect(loaded).not.toBeNull();
    expect(loaded?.return_to).toBeNull();
  });

  it('протухшую запись не отдаёт: счёт живёт не дольше получаса', () => {
    const stale = { ...info(CHECKOUT_RETURN), created_at: Date.now() - 31 * 60 * 1000 };
    localStorage.setItem(KEY, JSON.stringify(stale));

    expect(loadTopUpPendingInfo()).toBeNull();
  });

  it('мусор в хранилище не роняет экран', () => {
    localStorage.setItem(KEY, 'не json');

    expect(loadTopUpPendingInfo()).toBeNull();
  });
});
