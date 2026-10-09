// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { clearStaleSessionIfNeeded } from './token';

// ВК-16 (16в-1, волна 2). Ответ «да» на «уже оформлено» принадлежит ОДНОМУ человеку. На общем телефоне (два стенда)
// второй аккаунт не должен получить чужое «да»: сервер счёл бы его покупку подтверждённой и выставил бы ещё один срок
// без вопроса (мина OP). Ключ зашит литералом.
const initFor = (id: number) => `user=${encodeURIComponent(JSON.stringify({ id }))}&hash=x`;

describe('смена аккаунта Телеграма стирает ответ «да» на «уже оформлено»', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('другой человек — запись стёрта', () => {
    localStorage.setItem('tg_user_id', '185');
    localStorage.setItem('topup_order_confirmed', '{"period_days":30}');
    clearStaleSessionIfNeeded(initFor(196));
    expect(localStorage.getItem('topup_order_confirmed')).toBeNull();
  });

  it('тот же человек — запись на месте', () => {
    localStorage.setItem('tg_user_id', '185');
    localStorage.setItem('topup_order_confirmed', '{"period_days":30}');
    clearStaleSessionIfNeeded(initFor(185));
    expect(localStorage.getItem('topup_order_confirmed')).toBe('{"period_days":30}');
  });
});
