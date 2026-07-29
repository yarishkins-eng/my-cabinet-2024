import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DeviceFirstConfigurator.tsx', import.meta.url), 'utf8');

describe('DeviceFirstConfigurator responsive and modal contract', () => {
  it('caps the device grid at four columns with an explicit narrow fallback', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain('min-[360px]:grid-cols-2');
    expect(source).toContain('md:grid-cols-3');
    expect(source).toContain('lg:grid-cols-4');
    expect(source).toContain('max-w-3xl');
    expect(source).not.toContain('repeat(auto-fit');
  });

  it('keeps modal actions inside the dialog and hides the background header', () => {
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('inert={modalOpen || undefined}');
    expect(source).toContain("['configuration', 'confirmation', 'awaiting_payment']");
    expect(source.match(/onClick=\{\(\) => cancelMutation\.mutate\(\)\}/g)?.length).toBe(3);
  });

  it('preserves visible and semantic selected states', () => {
    expect(source).toContain('role="radio"');
    expect(source).toContain('aria-checked={devices === value}');
    expect(source).toContain("✓ {t('deviceFirst.selected')}");
  });
});
