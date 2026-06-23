import { computeScreenState, type ScreenState, type ScreenStateInput } from '../utils/screenState';

export type { ScreenState, ScreenStateInput } from '../utils/screenState';

/**
 * Тонкая обёртка над чистой `computeScreenState` — стабильная точка входа для
 * компонентов (чат 3). Мемоизацию оставляем React Compiler (он в сборке): он
 * закэширует вызов по реальным реактивным входам. Ручной `useMemo([input])` тут
 * бесполезен — вызывающий пересоздаёт объект `input` каждый рендер. Вся логика —
 * в `utils/screenState.ts`.
 */
export function useScreenState(input: ScreenStateInput): ScreenState {
  return computeScreenState(input);
}
