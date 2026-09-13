import { describe, expect, it } from 'vitest';

import en from './en.json';
import ru from './ru.json';

/**
 * ПТ-1: тесты карточки и экрана `/trial` мокают `t` как «ключ → ключ», поэтому пропавший или
 * переименованный ключ они не заметят — человек увидел бы служебное имя вместо текста.
 * Здесь ключи, которые эти экраны теперь показывают, сверяются с настоящими словарями.
 */
const KEYS = [
  'subscription.trial.activate',
  'trialStart.activating',
  'trialStart.orderChanged',
  'trialStart.activateError',
  'deviceFirst.errorRestricted',
];

function read(dictionary: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      dictionary,
    );
}

describe('ПТ-1: ключи локали, которые показывает активация пробного', () => {
  it.each(KEYS)('%s есть в ru и en и не пуст', (key) => {
    for (const dictionary of [ru, en]) {
      const value = read(dictionary, key);
      expect(typeof value).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('текст для 403 не зовёт повторить то, откуда только что отбили', () => {
    expect(read(ru, 'deviceFirst.errorRestricted')).not.toMatch(/ещё раз|снова/i);
    expect(read(ru, 'deviceFirst.errorRestricted')).toMatch(/поддержк/i);
  });
});
