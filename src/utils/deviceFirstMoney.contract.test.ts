import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Пункт 4.2б: клиенту не врать «Платёж получен» там, где он не платил.
 *
 * Мутационный прогон показал три дыры, которые пережили весь набор: карточку на Главной
 * можно было снова захардкодить на «Оплату нужно проверить», а отказ — вернуть на общий
 * ключ `errorPaymentChecking`, и ни один тест бы не покраснел. Оба места видит клиент
 * первыми, а рендер-теста у Главной нет вовсе — поэтому сторожим по исходнику.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const locale = (name: string) =>
  JSON.parse(read(`../locales/${name}.json`)) as { deviceFirst: Record<string, string> };

describe('вердикт о деньгах доведён до всех экранов', () => {
  it('карточка на Главной берёт текст из вердикта, а не из зашитого ключа', () => {
    const source = read('../pages/DashboardUnified.tsx');
    expect(source).toContain('operatorReviewCopy(deviceFirstRecovery.money_state).titleKey');
    expect(source).toContain('operatorReviewCopy(deviceFirstRecovery.money_state).textKey');
    // Зашитый ключ остаётся только там, где он верен по смыслу, — но не в ветке operator.
    expect(source).not.toContain(
      "recoveryVariant === 'operator'\n              ? t('deviceFirst.paymentMismatch",
    );
  });

  it('экран покупки ветвится по вердикту и не трогает остальные состояния', () => {
    const source = read('../components/subscription/purchase/DeviceFirstConfigurator.tsx');
    expect(source).toContain('operatorReviewCopy(checkout.money_state).titleKey');
    expect(source).toContain('operatorReviewCopy(checkout.money_state).textKey');
    // Прежняя ветка `payment_amount_mismatch` для НЕ-operator_review состояний цела.
    expect(source).toContain("checkout.terminal_reason === 'payment_amount_mismatch'");
  });

  it('у отказа свой текст, а не общий «мы проверяем созданный счёт»', () => {
    const source = read('../components/subscription/purchase/DeviceFirstConfigurator.tsx');
    expect(source).toContain("operator_review_required: 'deviceFirst.errorOperatorReview'");
    expect(source).not.toContain("operator_review_required: 'deviceFirst.errorPaymentChecking'");
    // Два честных кода остаются на общем ключе — там счёт действительно есть.
    expect(source).toContain("reconciliation_required: 'deviceFirst.errorPaymentChecking'");
  });

  it('новые ключи есть во всех четырёх языках', () => {
    const keys = [
      'reviewUnpaidTitle',
      'reviewUnpaidText',
      'reviewUnknownTitle',
      'reviewUnknownText',
      'errorOperatorReview',
    ];
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      for (const key of keys) {
        expect(locale(language).deviceFirst[key], `${language}.${key}`).toBeTruthy();
      }
    }
  });

  it('мина F: экран покупки ветвится и на закрытую брошенную корзину', () => {
    // Без этой ветки предупреждение про живую ссылку исчезло бы вместе с состоянием
    // `operator_review`, а покупают как раз через мини-апп.
    const source = read('../components/subscription/purchase/DeviceFirstConfigurator.tsx');
    expect(source).toContain('closedCartCopy(checkout?.terminal_reason, checkout?.money_state)');
    expect(source).toContain('t(closedCart.titleKey)');
    expect(source).toContain('t(closedCart.textKey)');
  });

  it('мина F: ключи закрытой корзины есть во всех четырёх языках', () => {
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      for (const key of [
        'abandonedCartTitle',
        'abandonedCartText',
        'lateCreditTitle',
        'lateCreditText',
      ]) {
        expect(locale(language).deviceFirst[key], `${language}.${key}`).toBeTruthy();
      }
    }
  });

  it('мина F: текст закрытой корзины предупреждает про ссылку и называет баланс', () => {
    // Здесь, в отличие от экрана разбора, баланс обещать МОЖНО и нужно: заказ уже
    // `cancelled`, а это и есть условие возврата поздних денег на баланс.
    const ru = locale('ru').deviceFirst.abandonedCartText;
    expect(ru).toContain('не оплачивайте её');
    expect(ru).toContain('баланс');
    expect(ru).toContain('не оформится');
    expect(locale('en').deviceFirst.abandonedCartText.toLowerCase()).toContain('do not use it');
  });

  it('мина F: поздней оплате не говорят «деньги не списаны»', () => {
    // Единственный случай, когда деньги есть. До этой ветки экран показывал ему общий
    // «цена изменилась, деньги без подтверждения не списаны» — неправда дважды.
    const ru = locale('ru').deviceFirst.lateCreditText;
    expect(ru).toContain('баланс');
    expect(ru).not.toContain('не списан');
    expect(locale('en').deviceFirst.lateCreditText.toLowerCase()).toContain('balance');
  });

  it('мина W: предупреждение перед уходом говорит и про возврат, и про судьбу заказа', () => {
    const ru = locale('ru').deviceFirst.leavingForProvider;
    // Обещание привязано к сроку счёта: мина F закрывает брошенную корзину примерно
    // через полчаса, и безусловное «заказ ждёт на Главной» стало бы неправдой.
    expect(ru).toContain('Пока счёт действует');
    expect(ru).toContain('закрыв мини-приложение');
    // Имя экрана обязано совпадать с навигацией, иначе человека зовут туда, чего нет:
    // первая версия звала на «Home» и «صفحه اصلی», а вкладки называются Dashboard и
    // داشبورد. Сверяем по корню — в русском и персидском имя склоняется («на Главной»).
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const dashboard = (
        JSON.parse(read(`../locales/${language}.json`)) as {
          nav: Record<string, string>;
        }
      ).nav.dashboard;
      expect(locale(language).deviceFirst.leavingForProvider, `${language}`).toContain(
        dashboard.slice(0, -2),
      );
    }
  });

  it('текст «денег не было» предупреждает про старую ссылку и не обещает баланс', () => {
    // Причина, по которой заказ попадает в эту ветку, ставится когда провайдер ещё считает
    // счёт живым: ссылка может принять деньги. А возврат на баланс требует статуса
    // `cancelled`, которого здесь нет — обещать его нельзя.
    const ru = locale('ru').deviceFirst.reviewUnpaidText;
    expect(ru).toContain('не платите по ней');
    expect(ru).not.toContain('баланс');
    expect(locale('en').deviceFirst.reviewUnpaidText.toLowerCase()).toContain('do not use it');
  });
});
