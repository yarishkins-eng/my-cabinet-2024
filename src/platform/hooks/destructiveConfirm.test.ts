// @vitest-environment jsdom
/**
 * Скептик приёмки показал: мутация «убрать запасной ответ 'ok'» пережила ВСЕ 516 тестов —
 * каждый потребитель мокает хук целиком, и настоящее сравнение не проверял никто.
 * За этим хуком стоит экстренная остановка идущей рассылки и подтверждение отправки 300+ людям.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  dialog: { confirm: vi.fn(), alert: vi.fn(), popup: vi.fn() },
  capabilities: { hasNativeDialogs: true },
}));

vi.mock('@/platform/hooks/usePlatform', () => ({ usePlatform: () => platform }));

import { useDestructiveConfirm } from './useNativeDialog';

beforeEach(() => {
  platform.dialog.popup.mockReset();
  platform.dialog.confirm.mockReset();
  platform.capabilities.hasNativeDialogs = true;
});

describe('useDestructiveConfirm: согласие человека нельзя терять', () => {
  it('нативная кнопка действия засчитывается', async () => {
    platform.dialog.popup.mockResolvedValue('confirm');
    const { result } = renderHook(() => useDestructiveConfirm());
    await expect(result.current('Остановить?', 'Остановить')).resolves.toBe(true);
  });

  it('аварийный путь возвращает «ok» — и это ТОЖЕ согласие', async () => {
    // Так отвечает адаптер, когда нативный попап не открылся: уже открыт другой (второй
    // тап по «Стоп») или клиент старше Bot API 6.2. Пока сравнивали только с 'confirm',
    // человек жал «ОК», и действие молча не выполнялось.
    platform.dialog.popup.mockResolvedValue('ok');
    const { result } = renderHook(() => useDestructiveConfirm());
    await expect(result.current('Остановить?', 'Остановить')).resolves.toBe(true);
  });

  it('отказ и закрытие крестиком согласием не считаются', async () => {
    const { result } = renderHook(() => useDestructiveConfirm());
    platform.dialog.popup.mockResolvedValue('cancel');
    await expect(result.current('Остановить?', 'Остановить')).resolves.toBe(false);
    platform.dialog.popup.mockResolvedValue(null);
    await expect(result.current('Остановить?', 'Остановить')).resolves.toBe(false);
  });

  it('вне Телеграма идёт обычный confirm', async () => {
    platform.capabilities.hasNativeDialogs = false;
    platform.dialog.confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useDestructiveConfirm());
    await expect(result.current('Остановить?', 'Остановить')).resolves.toBe(true);
    expect(platform.dialog.popup).not.toHaveBeenCalled();
  });
});
