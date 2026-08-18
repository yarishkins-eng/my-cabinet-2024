import { readFileSync } from 'node:fs';
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

  it('never treats a broken connection as an answer, in the shapes axios really sends', () => {
    // 🔴 Формы взяты настоящие: у axios обрыв и таймаут несут `code`, и первая версия
    // сторожа этого не отражала — мутация «распознавать ещё и по `error.code`» её
    // пережила, хотя она прячет живой заказ при каждом моргании сети.
    expect(isNoOpenCheckoutError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(false);
    expect(
      isNoOpenCheckoutError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }),
    ).toBe(false);
    expect(isNoOpenCheckoutError({ code: 'ERR_CANCELED', message: 'canceled' })).toBe(false);
    // Ответ есть, но это не наш код: 5xx и «страницы нет» у FastAPI со строковым detail.
    expect(isNoOpenCheckoutError({ response: { status: 502, data: '' } })).toBe(false);
    expect(
      isNoOpenCheckoutError({ response: { status: 404, data: { detail: 'Not Found' } } }),
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

describe('Главная действительно пользуется распознавателем', () => {
  // 🔴 Мутационный прогон показал: подменить вызов `isNoOpenCheckoutError` на голую проверку
  // `status === 404` прямо в Главной можно при полностью зелёном наборе. Юнит выше сторожит
  // хелпер, а это — что страница ходит через него, а не заводит свою проверку рядом.
  // Тесты на функцию не доказывают, что функция ПОДКЛЮЧЕНА.
  const dashboard = readFileSync(
    new URL('../../pages/DashboardUnified.tsx', import.meta.url),
    'utf8',
  );
  // Границы берём по КОДУ, а не по словам: первая версия этого сторожа обрезала срез по
  // фразе, которая встречалась в комментарии рядом, и проверяла пустоту.
  const queryStart = dashboard.indexOf("queryKey: ['device-first-open-checkout']");
  const bodyStart = dashboard.indexOf('queryFn: async', queryStart);
  const openCheckoutQuery = dashboard.slice(
    bodyStart,
    dashboard.indexOf('\n    retry:', bodyStart),
  );

  it('гасит заказ через общий распознаватель, а не своей проверкой статуса', () => {
    expect(openCheckoutQuery).toContain('isNoOpenCheckoutError(error)');
    expect(openCheckoutQuery).toContain('throw error');
    // Никакой самодельной проверки статуса рядом: она проглотила бы чужой 404.
    expect(openCheckoutQuery).not.toContain('=== 404');
    expect(openCheckoutQuery).not.toContain('status === 404');
  });

  it('обновляет заказ жестом «потянуть вниз»', () => {
    // Единственный жест обновления на Главной. До пункта 4.11б этот ключ в списке
    // отсутствовал, и застрявшая карточка от жеста не двигалась.
    const pullRefresh = dashboard.slice(
      dashboard.indexOf('const handlePullRefresh'),
      dashboard.indexOf('const { pullDistance'),
    );
    expect(pullRefresh).toContain("queryKey: ['device-first-open-checkout']");
  });
});
