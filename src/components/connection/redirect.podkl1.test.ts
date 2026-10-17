// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStartParamPath } from '@/utils/telegramStartParam';

const html = readFileSync(resolve(process.cwd(), 'public/miniapp/redirect.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
function load({
  url = 'incy://import/example',
  bot = 'teplo_VPN_bot',
  lang = 'ru',
  ua = 'iPhone',
} = {}) {
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, '');
  Object.defineProperty(doc, 'hidden', { configurable: true, value: false });
  const location = { search: '?' + new URLSearchParams({ url, bot, lang }), href: '' };
  // Execute the repository's real standalone script against an isolated DOM.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', 'URLSearchParams', 'crypto', script)(
    { location },
    doc,
    { userAgent: ua },
    URLSearchParams,
    { randomUUID: () => crypto.randomUUID() },
  );
  return {
    doc,
    location,
    title: () => doc.getElementById('title')!.textContent,
    manual: doc.getElementById('manualBtn') as HTMLAnchorElement,
    back: doc.getElementById('telegramBtn') as HTMLAnchorElement,
    visibility(hidden: boolean) {
      Object.defineProperty(doc, 'hidden', { configurable: true, value: hidden });
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());
describe('real redirect HTML', () => {
  it.each(['INCY', 'Happ'])('shows Open %s immediately, then fallback at exactly3s', (app) => {
    const page = load({ url: `${app.toLowerCase()}://import/example` });
    expect(page.title()).toBe(`Открываем ${app}…`);
    expect(page.manual.hidden).toBe(false);
    expect(page.manual.textContent).toBe(`Открыть ${app}`);
    expect(page.back.hidden).toBe(true);
    expect(page.location.href).toBe(`${app.toLowerCase()}://import/example`);
    vi.advanceTimersByTime(2999);
    expect(page.title()).toBe(`Открываем ${app}…`);
    expect(page.back.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(page.title()).toBe('Не открылось?');
    expect(page.doc.getElementById('errorText')!.hidden).toBe(false);
    expect(page.back.hidden).toBe(false);
    const marker = new URL(page.back.href).searchParams.get('startapp');
    expect(resolveStartParamPath(marker)).toBe('/connection');
  });
  it('shows the exact Happ iPhone fallback and a different Android fallback', () => {
    let page = load({ url: 'happ://crypt5/payload' });
    vi.advanceTimersByTime(3000);
    expect(page.doc.getElementById('errorText')!.textContent).toBe(
      'Happ ещё не установлен? Вернитесь в Telegram и выберите INCY.',
    );
    page = load({ url: 'happ://crypt5/payload', ua: 'Android' });
    vi.advanceTimersByTime(3000);
    expect(page.doc.getElementById('errorText')!.textContent).toBe(
      'Happ ещё не установлен? Вернитесь в Telegram и нажмите «Установить».',
    );
  });
  it('changes to Done only after hide/return, including a later manual retry', () => {
    const page = load();
    vi.advanceTimersByTime(500);
    page.visibility(true);
    vi.advanceTimersByTime(3000);
    page.visibility(false);
    expect(page.title()).toBe('Готово. Вернитесь в Telegram.');
    expect(page.manual.hidden).toBe(true);
    expect(page.back.className).not.toContain('secondary');
    const retry = load();
    vi.advanceTimersByTime(4000);
    retry.manual.click();
    retry.visibility(true);
    retry.visibility(false);
    expect(retry.title()).toBe('Готово. Вернитесь в Telegram.');
  });
  it('does not call a late unrelated tab switch successful', () => {
    const page = load();
    vi.advanceTimersByTime(4000);
    page.visibility(true);
    page.visibility(false);
    expect(page.title()).toBe('Не открылось?');
  });
  it('generates a fresh return marker every visit', () => {
    expect(load().back.href).not.toBe(load().back.href);
  });
  it.each(['', 'bad/name', 'ab', 'x'.repeat(65), 'bot?start=evil'])(
    'hides return for invalid username %s',
    (bot) => {
      const page = load({ bot });
      expect(page.back.hidden).toBe(true);
      expect(page.back.hasAttribute('href')).toBe(false);
    },
  );
  it.each([
    '',
    'https://evil.test',
    // eslint-disable-next-line no-script-url
    'javascript:alert(1)',
    'data:text/html,x',
    'intent://evil',
    'file:///etc/passwd',
  ])('rejects unsafe URL %s', (url) => {
    const page = load({ url });
    expect(page.location.href).toBe('');
    expect(page.manual.hidden).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(page.title()).toBe('URL не указан');
  });
  it('uses the English copy with a regional locale', () => {
    const page = load({ lang: 'en-US' });
    expect(page.title()).toBe('Opening INCY…');
    expect(page.back.textContent).toBe('Back to Telegram');
  });
});
