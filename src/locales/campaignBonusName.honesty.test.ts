/**
 * РЕК-1: всплывашка о бонусе не показывает клиенту внутреннее имя рекламной кампании.
 *
 * `CampaignBonusNotifier.tsx` показывает тост на 8 секунд тому, кто зашёл по рекламной ссылке.
 * До этапа он печатал `по акции «{{name}}»`, где `name` — имя кампании из админки, а там у
 * владельца стоят внутренние клички с рекламным бюджетом («Кувалда 7000₽», «Киношная 4500»).
 *
 * ⛔ Лечение — НЕ переименование кампании: имя несёт бюджет и различает кампании на экране
 * статистики. Убрана подстановка из клиентского текста; на серверной стороне (бот) поле
 * `campaign_name` намеренно осталось — им пользуются админские уведомления владельцу.
 *
 * Сторож берёт ВСЕ строки блока во ВСЕХ локалях, поэтому новый ключ не протащит имя молча.
 */
import { describe, expect, it } from 'vitest';

import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';

const LOCALES = { ru, en, fa, zh } as Record<string, typeof ru>;

// Подстановка, которой имя кампании попадало в текст. Забор именно на неё: она и есть механизм.
const CAMPAIGN_NAME_PLACEHOLDER = '{{name}}';

describe('РЕК-1: имя рекламной кампании не уходит клиенту', () => {
  it.each(Object.keys(LOCALES))('%s: ни одна строка бонуса не подставляет имя кампании', (lang) => {
    const block = LOCALES[lang].campaignBonus as unknown as Record<string, string>;
    const strings = Object.entries(block).filter(([, value]) => typeof value === 'string');

    // Защита от пустого прогона: переименуют блок — сторож обязан упасть, а не позеленеть.
    expect(strings.length).toBeGreaterThanOrEqual(4);

    const offenders = strings
      .filter(([, value]) => value.includes(CAMPAIGN_NAME_PLACEHOLDER))
      .map(([key]) => `campaignBonus.${key}`);
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s: подпись про баланс осталась и называет сумму', (lang) => {
    // Убрать имя можно было и вместе со смыслом. Строка обязана продолжать говорить,
    // сколько человеку начислено, иначе тост превратился бы в пустое «Бонус активирован».
    expect(LOCALES[lang].campaignBonus.balance).toContain('{{amount}}');
  });
});
