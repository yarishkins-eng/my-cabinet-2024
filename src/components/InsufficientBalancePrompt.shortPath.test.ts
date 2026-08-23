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
    expect(SHARED_PROMPT).not.toContain('/balance/top-up/');
    expect(SHARED_PROMPT).not.toContain("'auto'");
    expect(SHARED_PROMPT).not.toContain("'option'");
    expect(SHARED_PROMPT).not.toContain('from=checkout');
  });
});
