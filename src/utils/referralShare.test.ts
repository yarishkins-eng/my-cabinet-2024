/**
 * Текст приглашения другу собирается по НАСТОЯЩИМ файлам локалей, а не по моку `t`.
 *
 * Именно так три месяца жила поломка: «Профиль» подставлял не те переменные, шаблон
 * оставлял «{{minimum}}» как есть, и ни один тест этого не видел — везде `t` был
 * замокан как `key => key`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { buildReferralShareText } from './referralShare';

type Locale = { referral: Record<string, string> };

function realT(language: string): TFunction {
  const locale = JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'locales', `${language}.json`), 'utf8'),
  ) as Locale;
  const t = (key: string, vars?: Record<string, unknown>) => {
    const [ns, name] = key.split('.');
    const template = (locale as Record<string, Record<string, string>>)[ns]?.[name];
    if (!template) throw new Error(`нет ключа ${key} в ${language}.json`);
    // Как i18next по умолчанию: неизвестную подстановку оставляет как есть.
    return template.replace(/\{\{(\w+)\}\}/g, (whole, v: string) =>
      vars && v in vars ? String(vars[v]) : whole,
    );
  };
  return t as unknown as TFunction;
}

const input = {
  botName: 'Teplo VPN',
  firstTopupBonusKopeks: 10000,
  minimum: '100 ₽',
  bonus: '100 ₽',
  percent: 25,
};

describe.each(['ru', 'en'])('текст приглашения, %s', (language) => {
  const t = realT(language);

  it('с бонусом: все подстановки заполнены, суммы и имя бота на месте', () => {
    const text = buildReferralShareText(t, input);

    expect(text).not.toContain('{{');
    expect(text).toContain('Teplo VPN');
    expect(text).toContain('100 ₽');
  });

  it('без бонуса: запасной текст про кешбэк, процент на месте', () => {
    const text = buildReferralShareText(t, { ...input, firstTopupBonusKopeks: 0 });

    expect(text).not.toContain('{{');
    expect(text).toContain('25');
    expect(text).not.toContain('100 ₽');
  });
});
