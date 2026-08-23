import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 Этап Б-2, ГРАНИЦА КОРОТКОГО ПУТИ. Экраны пополнения (`TopUpMethodSelect`, `TopUpAmount`)
// общие для двенадцати входов, и только один из них — касса device-first. Короткий путь
// (`/balance/top-up/platega` + `option` + `auto=1`) включается ТОЛЬКО меткой кассы.
//
// Почему его нельзя обобщать на всех, а не «просто так осторожничаем»: у докупки устройств и
// трафика корзина сохраняется БЕЗ `total_price` и `return_to_cart`, поэтому после пополнения
// она не исполняется. Ускорить оплату там значит массово доводить людей до платежа, за который
// они ничего не получат. А у двух входов (`SubscriptionCardExpired`, `Balance`) суммы в адресе
// нет вовсе — автосабмит выдал бы им красное «Введите сумму», которую они не вводили.
//
// ⚠️ Сторож читает ИСХОДНИК, и это его известная слабость (урок 19.08: «тест, читающий
// исходник, не ловит ничего»). Здесь он оправдан ровно одним: он стережёт ОТСУТСТВИЕ строки,
// а не наличие поведения. Поведение общего экрана проверяют его собственные вызовы; сюда
// смотрят, когда захотят «скопировать приём из кассы» — и вот тогда он покраснеет.
const SHARED_PROMPT = readFileSync(
  new URL('./InsufficientBalancePrompt.tsx', import.meta.url),
  'utf8',
);

describe('короткий путь кассы не протёк в общий экран нехватки', () => {
  it('sends the shared shortage prompt to the plain top-up screen, with no auto-submit', () => {
    expect(SHARED_PROMPT).toContain('/balance/top-up?');
    // Адрес обязан остаться БЕЗ хвоста провайдера: `/balance/top-up/platega` — короткий путь.
    expect(SHARED_PROMPT).not.toContain('/balance/top-up/');
    // 🔴 Проверка по СЛОВАМ, а не по кавычкам. Первая версия искала литералы `'auto'`/`'option'`
    // и была бы зелёной при мутации шаблонной строкой (`` `…?${params}&auto=1` ``) — нашла это
    // волна ревью, не мутация. Ловим обе формы разом: и `params.set('auto', …)`, и `&auto=1`.
    for (const forbidden of ['auto', 'option', 'from=checkout']) {
      expect(SHARED_PROMPT, `в общий экран нехватки просочилось «${forbidden}»`).not.toContain(
        forbidden,
      );
    }
  });
});
