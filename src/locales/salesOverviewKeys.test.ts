import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Экран продаж СП-1: каждая подпись есть на всех четырёх языках и с теми же подстановками —
 * иначе у другого языка вместо текста встанет имя ключа или сырое «{{count}}». */
type Json = Record<string, unknown>;
const LANGS = ['ru', 'en', 'zh', 'fa'] as const;

function load(lang: string): Json {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'locales', `${lang}.json`), 'utf8'),
  ) as Json;
}

function pick(root: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);
}

const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('sales overview texts', () => {
  const ru = load('ru');
  const overview = pick(ru, 'admin.salesStats.overview') as Record<string, string>;

  it('has the overview block with the owner-facing labels', () => {
    expect(overview.received).toBe('Пришло живых денег');
    expect(overview.payingHint).toBe('платили деньгами; Team и тестовые не считаются');
    expect(Object.keys(overview).length).toBeGreaterThanOrEqual(40);
  });

  for (const lang of LANGS) {
    it(`${lang}: every overview key exists with the same placeholders`, () => {
      const other = pick(load(lang), 'admin.salesStats.overview') as Record<string, string>;
      for (const [key, text] of Object.entries(overview)) {
        expect(typeof other[key], `${lang}.${key}`).toBe('string');
        expect(placeholders(other[key]), `${lang}.${key}`).toEqual(placeholders(text));
      }
      for (const key of [
        'yesterday',
        'thisMonth',
        'lastMonth',
        'week',
        'month',
        'quarter',
        'all',
        'custom',
      ]) {
        expect(
          typeof pick(load(lang), `admin.salesStats.period.${key}`),
          `${lang} period.${key}`,
        ).toBe('string');
      }
    });
  }

  it('renames the admin panel tiles like the «Пользователи» screen', () => {
    expect(pick(ru, 'admin.panel.statsTrials')).toBe('На пробном');
    expect(pick(ru, 'admin.panel.statsPaid')).toBe('Платят');
  });
});
