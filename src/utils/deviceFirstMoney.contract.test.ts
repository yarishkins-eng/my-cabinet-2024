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

  it('мина AR: ключи закрытого провайдером счёта есть во всех четырёх языках', () => {
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      for (const key of ['providerClosedTitle', 'providerClosedText']) {
        expect(locale(language).deviceFirst[key], `${language}.${key}`).toBeTruthy();
      }
    }
  });

  // 🔴 ПЕРЕПИСАН 26.08.2026 по находке волны 1. Первая редакция запрещала ДВЕ русских подстроки
  // и одну английскую — и линза текстов показала обход формулировкой, которая уже лежит в этом
  // же проекте («Списаний по нему не было», `operatorClosedNoMoneyText`). Плюс китайский и
  // персидский не проверялись по содержанию вовсе. Стережём КЛАСС утверждений, а не буквы, и во
  // всех четырёх языках.
  // ⚠️ Кириллицу писать явным диапазоном: `\w` в JavaScript — это `[A-Za-z0-9_]`, русские
  // слова он не ловит вовсе. Первая редакция класса из-за этого пропускала «Списаний по нему
  // не было»; поймал мета-сторож в конце файла, а не человек.
  const NO_CHARGE_CLAIM: Record<string, RegExp> = {
    ru: /не\s*списан|списани[а-яё]*\s+(по\s+\S+\s+)?не\s+было|ничего\s+не\s+списыв|деньги\s+остались|не\s+взяли|без\s+списани/i,
    en: /nothing was charged|no money was charged|not charged|did ?n[o']?t charge|balance is untouched|without (any )?charge/i,
    zh: /没有扣款|未扣款|不会扣款|没有收取|未收取/,
    fa: /کسر نشده|کسر نکردیم|کسر نمی|برداشت نشده/,
  };
  const WARNS_AGAINST_OLD_LINK: Record<string, RegExp> = {
    ru: /не платите по ней/i,
    en: /do not use it/i,
    zh: /不要使用/,
    fa: /استفاده نکنید/,
  };

  it('мина AR: про закрытый провайдером счёт предупреждают, но НИЧЕГО не утверждают про деньги', () => {
    // Свойств два, и они противоположны:
    //   (1) текст обязан предупредить, что старая ссылка ещё принимает деньги, — иначе он не
    //       защищает и ничем не отличается от прежнего молчания;
    //   (2) текст НЕ смеет заявить, что списания не было. Сервер на эту причину отвечает
    //       `unknown`, то есть НЕ ЗНАЕТ. Ровно эту ошибку разбирал пункт 4.2б, а соседний ключ
    //       `abandonedCartText` начинается со слов «Деньги не списаны» — готовое враньё в двух
    //       строках отсюда.
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const text = locale(language).deviceFirst.providerClosedText;
      expect(text, `${language}: предупреждение про старую ссылку`).toMatch(
        WARNS_AGAINST_OLD_LINK[language],
      );
      expect(text, `${language}: утверждение про несписание`).not.toMatch(
        NO_CHARGE_CLAIM[language],
      );
    }
  });

  it('мина AR: экраны загрузки и неудачного чтения тоже не утверждают про деньги', () => {
    // Оба экрана показываются, когда строки заказа ещё НЕТ, то есть система про деньги не знает
    // ничего. Здесь запрещено и «оплата учтена», и «денег не списывали» — обе стороны.
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      for (const key of ['restoringOrderText', 'restoringErrorText']) {
        const text = locale(language).deviceFirst[key];
        expect(text, `${language}.${key}`).toBeTruthy();
        expect(text, `${language}.${key}: утверждение про несписание`).not.toMatch(
          NO_CHARGE_CLAIM[language],
        );
      }
    }
    // И зеркально: обещания оплаты тоже нет.
    expect(locale('ru').deviceFirst.restoringOrderText).not.toContain('плата учтена');
    expect(locale('en').deviceFirst.restoringOrderText.toLowerCase()).not.toContain(
      'payment is recorded',
    );
  });

  it('мина AQ: тексты про отказ есть во всех четырёх языках и не утверждают про деньги', () => {
    // Плашка отказа появилась вместе с чтением метки `payment=failed`, а сторожа у неё не было
    // вовсе — нашла волна 2. Она делает проверяемое заявление («платёжная система сообщила»),
    // и заявление это про СЛОВА провайдера, а не про списание. Про деньги здесь молчим.
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      for (const key of [
        'providerDeclinedNoticeTitle',
        'providerDeclinedNotice',
        'errorInvoiceTerminal',
      ]) {
        const text = locale(language).deviceFirst[key];
        expect(text, `${language}.${key}`).toBeTruthy();
        expect(text, `${language}.${key}: утверждение про несписание`).not.toMatch(
          NO_CHARGE_CLAIM[language],
        );
      }
    }
    // ⚠️ И отдельно: плашка не смеет обещать, что счёт ещё можно оплатить. Адрес оплаты гаснет
    // раньше, чем закрывается заказ, — обещание «можно попробовать ещё раз» стояло здесь и было
    // снято волной 2 как непроверяемое.
    expect(locale('ru').deviceFirst.providerDeclinedNotice).not.toContain('попробовать ещё раз');
    expect(locale('en').deviceFirst.providerDeclinedNotice.toLowerCase()).not.toContain(
      'try again',
    );
  });

  it('мина AR: сторож несписания ловит формулировки, которые уже есть в проекте', () => {
    // 🔴 Сторож на сторожа. Первая редакция проверки пропускала «Списаний по нему не было» —
    // фразу из соседнего ключа этой же локали. Если класс перестанет её ловить, проверка выше
    // снова станет проверкой совпадения, и покраснеть должна ИМЕННО ЗДЕСЬ.
    expect(locale('ru').deviceFirst.operatorClosedNoMoneyText).toMatch(NO_CHARGE_CLAIM.ru);
    expect(locale('ru').deviceFirst.abandonedCartText).toMatch(NO_CHARGE_CLAIM.ru);
    expect(locale('en').deviceFirst.abandonedCartText).toMatch(NO_CHARGE_CLAIM.en);
    expect(locale('zh').deviceFirst.abandonedCartText).toMatch(NO_CHARGE_CLAIM.zh);
    expect(locale('fa').deviceFirst.abandonedCartText).toMatch(NO_CHARGE_CLAIM.fa);
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
    // 🔴 Пункт 1 реза 22.08.2026. Прежняя проверка сторожила букву «закрыв
    // мини-приложение» — так было, пока уход подменял документ и вернуться можно было
    // только закрыв мини-апп. Теперь экран остаётся жить за страницей оплаты, и та фраза
    // стала бы ложью. Сторожим не букву, а СВОЙСТВО: текст не смеет обещать, что кабинет
    // подменят, и обязан сказать, что экран останется.
    expect(ru).toContain('останется');
    expect(ru).not.toContain('вместо кабинета');
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
