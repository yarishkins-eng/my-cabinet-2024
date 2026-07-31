import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DeviceFirstConfigurator.tsx', import.meta.url), 'utf8');
const locale = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../locales/${name}.json`, import.meta.url), 'utf8')) as {
    deviceFirst: Record<string, string>;
  };

describe('DeviceFirstConfigurator responsive and modal contract', () => {
  it('caps the device grid at four columns with an explicit narrow fallback', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain('min-[360px]:grid-cols-2');
    expect(source).toContain('md:grid-cols-3');
    expect(source).toContain('lg:grid-cols-4');
    expect(source).toContain('max-w-3xl');
    expect(source).not.toContain('repeat(auto-fit');
  });

  it('portals modal actions above the whole app and makes the background inert', () => {
    expect(source).toContain('createPortal');
    expect(source).toContain("document.getElementById('root')");
    expect(source).toContain('appRoot.inert = true');
    expect(source).toContain('aria-modal={portal || undefined}');
    expect(source).toContain('fixed inset-0 z-[100]');
    expect(source).toContain("['configuration', 'confirmation', 'awaiting_payment']");
    expect(source.match(/onClick=\{\(\) => cancelMutation\.mutate\(\)\}/g)?.length).toBe(3);
  });

  it('keeps selected state semantic without a layout-shifting visible badge', () => {
    expect(source).toContain('role="radio"');
    expect(source).toContain('aria-checked={isSelected}');
    expect(source).toContain('sr-only');
    expect(source).not.toContain("✓ {t('deviceFirst.selected')}");
    expect(source).toContain('optionPrice.price_kopeks');
    expect(source).toContain('days === 365');
  });

  it('uses prices only to compare device variants after a term is selected', () => {
    expect(source).toContain('min-h-16');
    expect(source).toContain('min-h-28');
    expect(source).toContain('md:grid-cols-4');
    expect(source).toMatch(/optionPrice\s*\?\s*periodLabel\(value\)/);
    expect(source).toContain("t('deviceFirst.unavailable')");
  });

  it('keeps each device card compact: one device label, total, and monthly comparison', () => {
    const deviceCard = source.slice(
      source.indexOf('className={`flex min-h-28'),
      source.indexOf('</button>', source.indexOf('className={`flex min-h-28')),
    );

    expect(deviceCard).toContain("t('deviceFirst.deviceCount', { count: value })");
    expect(deviceCard).toContain("t('deviceFirst.perDeviceMonth'");
    expect(deviceCard).not.toContain("t('deviceFirst.deviceShort'");
    expect(deviceCard).not.toContain('>{value}</span>');
    expect(source).toContain('periodDays === 365 ? 12 : periodDays / 30');
  });

  it('provides the complete checkout vocabulary to every language the cabinet advertises', () => {
    const russianKeys = Object.keys(locale('ru').deviceFirst).sort();
    for (const language of ['en', 'zh', 'fa']) {
      expect(Object.keys(locale(language).deviceFirst).sort()).toEqual(russianKeys);
    }
    expect(source).toContain("document.documentElement.dir === 'rtl'");
  });
});
