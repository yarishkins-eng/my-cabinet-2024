import { describe, expect, it } from 'vitest';

import { getFallbackParentPath } from './navigation';

// 🔴 Этап В-1. Экран результата пополнения стал ТОЧКОЙ ВХОДА: человек приземляется на него
// прямо из банка по диплинку, и истории под ним нет. Общее правило «отрезать последний кусок
// адреса» дало бы `/balance/top-up` — приглашение выбрать способ и заплатить ещё раз, ровно
// тому, кто только что заплатил. Сторожа на это правило до сих пор не было ни одного:
// мутация, снимающая исключение, переживала весь набор.

describe('getFallbackParentPath — куда ведёт «назад», когда истории нет', () => {
  it('с экрана результата оплаты НЕ зовёт платить ещё раз', () => {
    expect(getFallbackParentPath('/balance/top-up/result')).toBe('/balance');
    // С завершающей косой чертой — тот же ответ: адрес приходит снаружи, из диплинка.
    expect(getFallbackParentPath('/balance/top-up/result/')).toBe('/balance');
  });

  // 🔴 Второй конец шкалы. Проверка одного исключения прошла бы и у кода, который на ВСЁ
  // отвечает «/balance»: общее правило обязано работать как прежде.
  it('всем остальным адресам отрезает последний кусок, как раньше', () => {
    expect(getFallbackParentPath('/balance/top-up')).toBe('/balance');
    expect(getFallbackParentPath('/balance/top-up/platega')).toBe('/balance/top-up');
    expect(getFallbackParentPath('/admin/users/123')).toBe('/admin/users');
    expect(getFallbackParentPath('/info')).toBe('/');
    expect(getFallbackParentPath('/')).toBe('/');
    expect(getFallbackParentPath('')).toBe('/');
  });
});
