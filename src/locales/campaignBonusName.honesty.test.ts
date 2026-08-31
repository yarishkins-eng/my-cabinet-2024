/**
 * РЕК-1: всплывашка о бонусе не показывает клиенту внутреннее имя рекламной кампании.
 *
 * `CampaignBonusNotifier.tsx` показывает тост на 8 секунд тому, кто зашёл по рекламной ссылке.
 * До этапа он печатал `по акции «{{name}}»`, где `name` — имя кампании из админки, а там у
 * владельца стоят внутренние клички с рекламным бюджетом («Кувалда 7000₽», «Киношная 4500»).
 *
 * ⛔ Лечение — НЕ переименование кампании: имя несёт бюджет и различает кампании на экране
 * статистики РК-1/РК-2 (он читает модель напрямую и правкой не задет).
 *
 * ⚠️ ГРАНИЦА, названная честно: сервер ПО-ПРЕЖНЕМУ кладёт имя в ответ авторизации
 * (`bot-code/app/cabinet/routes/auth.py` → `CampaignBonusInfo.campaign_name`), и оно приезжает
 * в браузер, хотя на экран не попадает. Поле сегодня не читает никто, кроме
 * `CampaignBonusNotifier`, который отдаёт его в i18next, а тот лишнюю подстановку выбрасывает.
 * Убирать поле — правка серверной схемы, она в РЕК-1 не входит и названа остатком, а не
 * «намеренно оставлена ради админских уведомлений»: те читают модель из базы, а не это поле.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 🔴 Каталог читается, а не импортируется поимённо. Прежний сторож жёстко перечислял четыре
// локали, и пятая прошла бы мимо забора молча — при том что докстринг обещал «во ВСЕХ локалях».
// `fileURLToPath`, а не `.pathname`: в пути проекта кириллица, и сырой URL приходит
// percent-encoded — каталог по нему не открывается.
const LOCALES_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = fs.readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'));

const REQUIRED_KEYS = ['balance', 'subscription', 'tariff'] as const;

// Подстановка, которой имя кампании попадало в текст. i18next допускает пробелы внутри скобок,
// поэтому забор ставится регуляркой, а не сравнением с точным написанием `{{name}}`.
const NAME_PLACEHOLDER = /\{\{\s*name\s*\}\}/;

// Имена кампаний с боевого сервера: если их впишут в локаль буквально, подстановки не будет,
// и забор по ней промолчит. Ловим и это.
const LIVE_CAMPAIGN_NAMES = ['Кувалда', 'Киношная'];

function bonusBlock(file: string): Record<string, string> {
  const data = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf-8'));
  return data.campaignBonus ?? {};
}

describe('РЕК-1: имя рекламной кампании не уходит клиенту', () => {
  it('локали вообще найдены', () => {
    expect(LOCALE_FILES.length).toBeGreaterThan(0);
  });

  it.each(LOCALE_FILES)('%s: все ключи бонуса на месте', (file) => {
    // Пропажа ключа — не косметика: тост потеряет текст, а сторож на подстановку промолчит.
    const block = bonusBlock(file);
    expect(REQUIRED_KEYS.filter((key) => typeof block[key] !== 'string')).toEqual([]);
  });

  it.each(LOCALE_FILES)('%s: ни одна строка не подставляет имя кампании', (file) => {
    const block = bonusBlock(file);
    const offenders = Object.entries(block)
      .filter(([, value]) => typeof value === 'string' && NAME_PLACEHOLDER.test(value))
      .map(([key]) => `campaignBonus.${key}`);
    expect(offenders).toEqual([]);
  });

  it.each(LOCALE_FILES)('%s: ни одна строка не вписывает имя кампании буквально', (file) => {
    const block = bonusBlock(file);
    const offenders = Object.entries(block)
      .filter(
        ([, value]) =>
          typeof value === 'string' && LIVE_CAMPAIGN_NAMES.some((n) => value.includes(n)),
      )
      .map(([key]) => `campaignBonus.${key}`);
    expect(offenders).toEqual([]);
  });

  it.each(LOCALE_FILES)('%s: убрав имя, не потеряли числа', (file) => {
    // Вычистить имя можно было и вместе со смыслом: тост обязан продолжать называть
    // сумму, срок и тариф, иначе он превратится в пустое «Бонус активирован».
    const block = bonusBlock(file);
    expect(block.balance).toMatch(/\{\{\s*amount\s*\}\}/);
    expect(block.subscription).toMatch(/\{\{\s*days\s*\}\}/);
    expect(block.tariff).toMatch(/\{\{\s*tariff\s*\}\}/);
  });
});
