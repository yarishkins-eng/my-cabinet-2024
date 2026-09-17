import { describe, expect, it } from 'vitest';
import { getGlassColors } from './glassTheme';

/**
 * Стеклянные карточки живут на тёмном фоне. Эти константы читают ~20 экранов,
 * ни один из них не рендерится тестом с настоящим модулем — значит возврат
 * светлой заливки (белая плашка на тёмном) не поймал бы никто, кроме глаза.
 */
describe('getGlassColors — тёмное стекло', () => {
  it('все значения — светлое на тёмном, ни одного тёмного-на-светлом', () => {
    const g = getGlassColors();
    const all = JSON.stringify(g);
    // Светлая палитра была «чёрное с малой альфой на белом» и белые заливки ≥ 0,8.
    expect(all).not.toMatch(/rgba\(0,0,0,/);
    expect(all).not.toMatch(/rgba\(255,255,255,0\.[89]/);
    expect(all).not.toContain('#1a1a2e');
    expect(g.cardBg).toContain('rgba(255,255,255,0.05)');
    expect(g.text).toBe('#fff');
  });
});
