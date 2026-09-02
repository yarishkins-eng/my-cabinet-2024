/**
 * РС-14ж: подпись сегмента промо-предложений не должна лгать про то, кого она отбирает.
 *
 * Предикат `zero` в боте (`app/handlers/admin/messages.py`, get_target_users) отбирает людей
 * с ДЕЙСТВУЮЩЕЙ подпиской и нулём потраченного трафика — «оплатил и ни разу не подключился».
 * Подпись «Нулевой баланс» обещала должников. После СК-2 скидка по такой рассылке приземляется
 * забираемой кнопкой на Главной, то есть неверная подпись кладёт деньги не тем людям.
 * Настоящий баланс — соседний `lowBalance`, он подписан правильно и здесь не трогается.
 */
import { describe, expect, it } from 'vitest';

import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';

const LOCALES = { ru, en, fa, zh } as Record<string, typeof ru>;

describe('РС-14ж: честные подписи сегментов промо', () => {
  it.each(Object.keys(LOCALES))('%s: «zero» не обещает баланс', (lang) => {
    const label = LOCALES[lang].admin.promoOffers.segments.zero.toLowerCase();
    expect(label).not.toMatch(/баланс|balance|موجودی|余额/);
  });

  it.each(Object.keys(LOCALES))('%s: «zero» не обещает ОПЛАТУ', (lang) => {
    // Первая правка РС-14ж заменила ложь про баланс на ложь про оплату: предикат смотрит
    // `s.is_active`, а `is_active` (models.py:2527) = «статус ACTIVE и срок не вышел» и про
    // деньги не знает вовсе. Действующий пробный период тоже `is_active`, поэтому сегмент
    // состоит в основном из триальщиков, которые ничего не платили.
    const label = LOCALES[lang].admin.promoOffers.segments.zero.toLowerCase();
    expect(label).not.toMatch(/оплат|платил|paid|pay|پرداخت|付费|付費/);
  });

  it.each(Object.keys(LOCALES))('%s: «zero» и «lowBalance» — разные подписи', (lang) => {
    const segments = LOCALES[lang].admin.promoOffers.segments;
    expect(segments.zero).not.toBe(segments.lowBalance);
  });

  it.each(Object.keys(LOCALES))('%s: у группы аудиторий «broad» есть заголовок', (lang) => {
    const groups = LOCALES[lang].admin.broadcasts.filterGroups as Record<string, string>;
    expect(groups.broad?.length ?? 0).toBeGreaterThan(0);
    expect(groups.broad).not.toBe(groups.basic);
  });

  it.each(Object.keys(LOCALES))(
    '%s: у последней группы «archive» есть отдельный заголовок',
    (lang) => {
      const groups = LOCALES[lang].admin.broadcasts.filterGroups as Record<string, string>;
      expect(groups.archive?.length ?? 0).toBeGreaterThan(0);
      expect(groups.archive).not.toBe(groups.broad);
    },
  );
});
