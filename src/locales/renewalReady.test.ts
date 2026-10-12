import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

const directory = path.dirname(fileURLToPath(import.meta.url));
const locales: Record<string, { deviceFirst: Record<string, string> }> = Object.fromEntries(
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [
      name.slice(0, -5),
      JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')),
    ]),
);

// JSON is a separate contract: the screen's translation mock cannot protect it.
describe('VK-5 renewal readiness translations', () => {
  it.each(Object.entries(locales))('interpolates the date in %s', async (language, locale) => {
    const text = locale.deviceFirst.readyRenewed;
    expect(text).toContain('{{date}}');
    const translator = i18next.createInstance();
    await translator.init({
      lng: language,
      resources: { [language]: { translation: locale } },
      interpolation: { escapeValue: false },
    });
    const rendered = translator.t('deviceFirst.readyRenewed', { date: '30.08.2026' });
    expect(rendered).toContain('30.08.2026');
    expect(rendered).not.toContain('{{');
    if (language === 'ru') expect(rendered).toBe('Подписка продлена до 30.08.2026 (МСК)');
    if (language === 'en')
      expect(rendered).toBe('Subscription extended until 30.08.2026 (Moscow time)');
  });

  it.each([
    ['ru', 'VPN готов', 'Срок и количество устройств уже обновлены.'],
    ['en', 'VPN is ready', 'The term and device limit are updated.'],
  ])('preserves first-purchase readiness in %s', (language, title, text) => {
    const messages = locales[language].deviceFirst;
    expect(messages.ready).toBe(title);
    expect(messages.readyText).toBe(text);
  });
});
