import { readFileSync } from 'node:fs';
import { createInstance, type Resource } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import en from './en.json';
import fa from './fa.json';
import ru from './ru.json';
import zh from './zh.json';

const resources: Resource = {
  ru: { translation: ru },
  en: { translation: en },
  zh: { translation: zh },
  fa: { translation: fa },
};
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ resources, fallbackLng: false, interpolation: { escapeValue: false } });
});

// Карточка пробного периода печатает число крупно, а подпись под ним берёт из словаря с числом
// и вырезает число: так подпись склоняется на любом сроке, а число не печатается дважды.
const stripCount = (value: string) => value.replace(/^\d+\s*/, '');

describe('trial card: day label declines for any trial length', () => {
  it.each([
    [1, 'день'],
    [2, 'дня'],
    [3, 'дня'],
    [4, 'дня'],
    [5, 'дней'],
    [7, 'дней'],
    [11, 'дней'],
    [14, 'дней'],
    [21, 'день'],
    [30, 'дней'],
  ])('ru: %i → %s', async (count, expected) => {
    await i18n.changeLanguage('ru');
    expect(stripCount(i18n.t('subscription.trial.days', { count }))).toBe(expected);
  });

  it.each([
    [1, 'day'],
    [3, 'days'],
  ])('en: %i → %s', async (count, expected) => {
    await i18n.changeLanguage('en');
    expect(stripCount(i18n.t('subscription.trial.days', { count }))).toBe(expected);
  });

  it('the card passes the count and strips it from the label', () => {
    const source = readFileSync(
      new URL('../components/dashboard/TrialOfferCard.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain("t('subscription.trial.days', { count: trialInfo.duration_days })");
    expect(source).not.toContain("label: t('subscription.trial.days') }");
  });
});

describe('tariff form: every validation error the form can raise has a translation', () => {
  const source = readFileSync(new URL('../pages/AdminTariffCreate.tsx', import.meta.url), 'utf8');
  const raised = [...source.matchAll(/validationErrors\.push\('([A-Za-z]+)'\)/g)].map((m) => m[1]);

  it('collects the raised error keys', () => {
    expect(raised.length).toBeGreaterThan(0);
    expect(raised).toContain('devicePurchaseOptionsInvalid');
  });

  it.each(['ru', 'en'] as const)('%s: no raw key leaks into the error list', async (lng) => {
    await i18n.changeLanguage(lng);
    for (const key of raised) {
      const text = i18n.t(`admin.tariffs.validation.${key}`);
      expect(text, key).not.toBe(`admin.tariffs.validation.${key}`);
      expect(text.length, key).toBeGreaterThan(0);
    }
  });
});
