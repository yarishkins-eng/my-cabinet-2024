import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import htmlSource from '../../index.html?raw';
import { DEFAULT_THEME_COLORS } from '../types/theme';

// Не `?raw`: CSS в vitest проходит через css-плагин и приходит пустой строкой.
const globalsCss = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');
const redirectHtml = readFileSync(
  new URL('../../public/miniapp/redirect.html', import.meta.url),
  'utf8',
);

// Любое объявление, которое вернуло бы браузеру светлую схему (в CSS или в meta).
const LIGHT_SCHEME =
  /color-scheme:\s*(light|dark\s+light|light\s+dark)\b|content="(light|dark light|light dark)"/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Кабинет всегда тёмный и говорит об этом браузеру сам.
 *
 * Без `color-scheme: dark` родные элементы (выпадающие списки, поля даты,
 * автозаполнение, скроллбары) следуют за светлой темой телефона, а Android
 * WebView (Telegram на Xiaomi с системным «тёмным режимом для приложений»)
 * затемняет страницу своим алгоритмом — по слоям и не за один кадр.
 * Объявление стоит в index.html (первый кадр до CSS), в globals.css и на
 * странице-прослойке deep-link, которая открывается вне React. Светлой темы
 * в кабинете нет: ни объявления схемы, ни класса, ни палитры, ни варианта.
 */
describe('color-scheme страницы', () => {
  it('index.html объявляет тёмную схему до загрузки CSS и не знает светлой', () => {
    // После СТ-2 класс dark на <html> ставит только разметка: на нём держатся
    // .dark body, скроллбары и darkMode: 'class' в Tailwind.
    expect(htmlSource).toMatch(/<html[^>]*\sclass="dark"/);
    expect(htmlSource).toMatch(/<meta\s+name="color-scheme"\s+content="dark"\s*\/?>/);
    expect(htmlSource).toMatch(/html\s*{[^}]*color-scheme:\s*dark\b[^}]*}/);
    expect(htmlSource).not.toMatch(LIGHT_SCHEME);
    expect(htmlSource).not.toMatch(/prefers-color-scheme|html\.light/);
  });

  it('globals.css держит тёмную схему после загрузки приложения и не знает светлой', () => {
    expect(globalsCss).toMatch(/:root\s*{[^}]*color-scheme:\s*dark\b[^}]*}/);
    expect(globalsCss).not.toMatch(LIGHT_SCHEME);
    expect(globalsCss).not.toMatch(/\.light\b|champagne|prefers-color-scheme/);
  });

  it('index.html возвращает Telegram тёмные цвета по умолчанию — те же, что DEFAULT_THEME_COLORS', () => {
    // Старая telegram-web-app.js при поздней загрузке перекрашивает шапку/подложку/панель
    // в тему телефона; onload в index.html возвращает тёмное. Константы там — копия
    // DEFAULT_THEME_COLORS (не серверной палитры — мина MM), и без этого сторожа
    // четыре копии разъедутся молча.
    expect(htmlSource).toContain(
      `<meta name="theme-color" content="${DEFAULT_THEME_COLORS.darkBackground}"`,
    );
    expect(htmlSource).toContain(`setBackgroundColor('${DEFAULT_THEME_COLORS.darkBackground}')`);
    expect(htmlSource).toContain(`setHeaderColor('${DEFAULT_THEME_COLORS.darkSurface}')`);
    expect(htmlSource).toContain(`setBottomBarColor('${DEFAULT_THEME_COLORS.darkSurface}')`);
    expect(htmlSource).toContain(`background-color: ${DEFAULT_THEME_COLORS.darkBackground}`);
  });

  it('страница-прослойка deep-link тёмная и не следует за темой телефона', () => {
    expect(redirectHtml).toMatch(/<meta\s+name="color-scheme"\s+content="dark"\s*\/?>/);
    expect(redirectHtml).toMatch(/body\s*{[^}]*background:\s*linear-gradient\(135deg,\s*#1a1a2e/);
    expect(redirectHtml).not.toMatch(LIGHT_SCHEME);
    expect(redirectHtml).not.toMatch(/prefers-color-scheme/);
  });

  it('в разметке нет вариантов light:/dark: — тёмная тема единственная и безусловная', () => {
    // Tailwind 3 молча выбрасывает классы с неизвестным вариантом (`light:`), а
    // `dark:` при darkMode: 'class' тихо вернул бы двойную систему. Сборка,
    // линт и типы этого не видят — только этот сторож.
    const offenders: string[] = [];
    for (const file of walk(fileURLToPath(new URL('..', import.meta.url)))) {
      const text = readFileSync(file, 'utf8');
      // Плюс классы снесённой палитры и переменные светлой: Tailwind и браузер
      // выбросят их молча, а в дереве они означают, что светлая ветка вернулась.
      const hit = text.match(/['"`\s](light|dark):[a-z[]|champagne|--color-light-/);
      if (hit) offenders.push(`${file.replace(/^.*\/src\//, 'src/')}: ${hit[0].trim()}`);
    }
    expect(offenders).toEqual([]);
  });
});
