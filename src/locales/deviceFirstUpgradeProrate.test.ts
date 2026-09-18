import { describe, expect, it } from 'vitest';

import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';

/**
 * МД-1 (мина MD): тесты экрана мокают `t` как «ключ → ключ», поэтому пропавший ключ они не
 * заметят — человек увидел бы служебное имя вместо строки про доплату. Ключ сверяется с
 * настоящими словарями всех четырёх языков кабинета.
 */
const KEY = 'deviceFirst.upgradeProrateNote';

function read(dictionary: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      dictionary,
    );
}

describe('МД-1: строка про доплату за остаток срока', () => {
  it.each([
    ['ru', ru],
    ['en', en],
    ['zh', zh],
    ['fa', fa],
  ])('%s: ключ есть, не пуст и несёт обе подстановки', (_lang, dictionary) => {
    const value = read(dictionary, KEY);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
    expect(value as string).toContain('{{amount}}');
    expect(value as string).toContain('{{days}}');
  });

  it('русский текст называет остаток текущего срока, а не новый период', () => {
    expect(read(ru, KEY)).toMatch(/текущего срока/);
  });
});
