import { describe, expect, it } from 'vitest';
import { resolveCheckoutReturn } from './safeRedirect';

// 🔴 Этап Б-1. Этот сторож охраняет ГРАНИЦУ исключения, а не факт его существования.
// Возврат на кассу после пополнения — единственное место, где адрес из строки запроса
// превращается в переход. Все имена и пути здесь зашиты ЛИТЕРАЛАМИ намеренно: сторож,
// берущий константу из проверяемого кода, доказывает только сам себя.
describe('resolveCheckoutReturn', () => {
  it('возвращает на кассу, когда стоит её собственная метка', () => {
    expect(resolveCheckoutReturn('/subscription/purchase?from=checkout&period=90&devices=5')).toBe(
      '/subscription/purchase?from=checkout&period=90&devices=5',
    );
  });

  // 🔴 Главная граница. На том же маршруте живут TariffPurchaseForm, ClassicPurchaseWizard
  // и SwitchTariffSheet, и общий InsufficientBalancePrompt кладёт в returnTo ровно эту строку
  // — без метки. Их поведение (уход на Главную, где видна исполнившаяся корзина) меняться
  // не должно: у них корзина на сервере есть, а у кассы её нет вовсе.
  it('НЕ трогает соседние экраны на том же маршруте — у них метки нет', () => {
    expect(resolveCheckoutReturn('/subscription/purchase')).toBeNull();
    expect(resolveCheckoutReturn('/subscription/purchase?tariff=3')).toBeNull();
    expect(resolveCheckoutReturn('/subscription/purchase?from=renewal')).toBeNull();
  });

  it('НЕ трогает остальные экраны, откуда ходят пополнять', () => {
    expect(resolveCheckoutReturn('/subscription')).toBeNull();
    expect(resolveCheckoutReturn('/balance')).toBeNull();
    expect(resolveCheckoutReturn('/')).toBeNull();
    expect(resolveCheckoutReturn(null)).toBeNull();
    expect(resolveCheckoutReturn(undefined)).toBeNull();
    expect(resolveCheckoutReturn('')).toBeNull();
  });

  // 🔴 Сравнение пути ТОЧНОЕ, а не префиксом. Иначе чужой маршрут, начинающийся так же,
  // получил бы права кассы.
  it('не принимает похожий маршрут за кассу', () => {
    expect(resolveCheckoutReturn('/subscription/purchase-history?from=checkout')).toBeNull();
    expect(resolveCheckoutReturn('/subscription/purchase/extra?from=checkout')).toBeNull();
  });

  // 🔴 getSafeRedirectPath пропускает `/\evil.com`: обратный слэш парсер URL приравнивает
  // к прямому, и строка разрешается в https://evil.com/. Одного этого валидатора мало,
  // поэтому здесь стоит вторая проверка — по origin и точному пути.
  it('отбивает увод наружу, который проходит мимо общего валидатора', () => {
    expect(resolveCheckoutReturn('/\\evil.com')).toBeNull();
    expect(resolveCheckoutReturn('/\\evil.com/subscription/purchase?from=checkout')).toBeNull();
    expect(resolveCheckoutReturn('//evil.com/subscription/purchase?from=checkout')).toBeNull();
    expect(
      resolveCheckoutReturn('https://evil.com/subscription/purchase?from=checkout'),
    ).toBeNull();
    // Собирается из кусков, а не пишется литералом: литерал ловит правило `no-script-url`,
    // а глушить правило ради проверки враждебного ввода — менять сторожа на его отсутствие.
    expect(resolveCheckoutReturn(['javascript', 'alert(1)'].join(':'))).toBeNull();
    expect(resolveCheckoutReturn('%2F%2Fevil.com/subscription/purchase?from=checkout')).toBeNull();
  });
});
