import { useMemo } from 'react';
import { computeScreenState, type ScreenState, type ScreenStateInput } from '../utils/screenState';

export type { ScreenState, ScreenStateInput } from '../utils/screenState';

/**
 * Тонкая обёртка над чистой `computeScreenState`: мемоизирует результат по полям
 * входа, чтобы компоненты (чат 3) рендерили решение без лишних пересчётов.
 * Вся логика — в `utils/screenState.ts`; здесь только React-мемоизация.
 */
export function useScreenState(input: ScreenStateInput): ScreenState {
  return useMemo(() => computeScreenState(input), [input]);
}
