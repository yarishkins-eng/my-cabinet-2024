import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import htmlSource from '../../index.html?raw';

// Не `?raw`: CSS в vitest проходит через css-плагин и приходит пустой строкой.
const globalsCss = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');
const redirectHtml = readFileSync(
  new URL('../../public/miniapp/redirect.html', import.meta.url),
  'utf8',
);

/**
 * Кабинет всегда тёмный и говорит об этом браузеру сам.
 *
 * Без `color-scheme: dark` родные элементы (выпадающие списки, поля даты,
 * автозаполнение, скроллбары) следуют за светлой темой телефона, а Android
 * WebView (Telegram на Xiaomi с системным «тёмным режимом для приложений»)
 * затемняет страницу своим алгоритмом — по слоям и не за один кадр.
 * Объявление стоит в index.html (первый кадр до CSS), в globals.css и на
 * странице-прослойке deep-link, которая открывается вне React.
 */
describe('color-scheme страницы', () => {
  it('index.html объявляет тёмную схему до загрузки CSS', () => {
    expect(htmlSource).toMatch(/<meta\s+name="color-scheme"\s+content="dark"\s*\/?>/);
    expect(htmlSource).toMatch(/html\s*{\s*color-scheme:\s*dark;?\s*}/);
    expect(htmlSource).not.toMatch(/prefers-color-scheme|html\.light/);
  });

  it('globals.css держит тёмную схему после загрузки приложения и не знает светлой', () => {
    expect(globalsCss).toMatch(/:root\s*{\s*color-scheme:\s*dark;?\s*}/);
    expect(globalsCss).not.toMatch(/\.light\b|champagne|prefers-color-scheme/);
  });

  it('страница-прослойка deep-link тёмная и не следует за темой телефона', () => {
    expect(redirectHtml).toMatch(/<meta\s+name="color-scheme"\s+content="dark"\s*\/?>/);
    expect(redirectHtml).not.toMatch(/prefers-color-scheme/);
  });
});
