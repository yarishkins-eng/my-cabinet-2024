import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  /** Что обновить при срабатывании жеста. Может быть async — индикатор крутится до конца. */
  onRefresh: () => Promise<unknown> | void;
  /** Выключить жест (например, когда открыта шторка или идёт начальная загрузка). */
  disabled?: boolean;
  /** Порог в пикселях (после сопротивления), после которого отпускание запускает обновление. */
  threshold?: number;
}

/**
 * «Потянуть вниз для обновления» (pull-to-refresh) для мобильного мини-аппа.
 *
 * Контейнер прокрутки кабинета — окно/`body` (шапка `fixed`, `main` в обычном потоке),
 * поэтому «мы вверху» = `window.scrollY === 0`. Жест безопасен: Telegram-свайп «потянуть
 * вниз = свернуть» отключён глобально (`disableVerticalSwipes` в main.tsx), а родной
 * overscroll браузера погашен (`overscroll-behavior-y: contain`). Поэтому свой жест ничего
 * не закрывает и не конфликтует с нативным обновлением.
 *
 * Возвращает `pullDistance` (для рисования индикатора по мере оттягивания) и `refreshing`
 * (идёт обновление). Логика хранится в ref-ах, чтобы обработчики касаний видели свежие
 * значения и слушатели не переподписывались на каждый кадр оттягивания.
 */
export function usePullToRefresh({
  onRefresh,
  disabled = false,
  threshold = 70,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const setPull = useCallback((d: number) => {
    pullRef.current = d;
    setPullDistance(d);
  }, []);

  useEffect(() => {
    if (disabled) return;

    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onStart = (e: TouchEvent) => {
      // Начинаем отслеживать жест только если палец один и мы в самом верху страницы.
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) {
        startYRef.current = null;
        return;
      }
      startYRef.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startYRef.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      // Тянут вверх / уже не вверху страницы → это обычная прокрутка, не наш жест.
      if (dy <= 0 || !atTop()) {
        if (pullRef.current !== 0) setPull(0);
        return;
      }
      // Эластичное сопротивление: реальное смещение в ~2 раза меньше пути пальца.
      const dist = Math.min(dy * 0.5, threshold * 1.6);
      setPull(dist);
      // Не даём странице тоже «тянуться»/обновляться, пока тянем мы.
      if (dist > 6 && e.cancelable) e.preventDefault();
    };

    const finish = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;
      const shouldRefresh = pullRef.current >= threshold;
      if (!shouldRefresh) {
        setPull(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(threshold * 0.6); // «защёлкнуть» индикатор на время обновления
      try {
        await onRefreshRef.current();
      } catch {
        // Сбой обновления не должен ломать UI — индикатор просто скроется.
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', finish, { passive: true });
    window.addEventListener('touchcancel', finish, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', finish);
      window.removeEventListener('touchcancel', finish);
    };
  }, [disabled, threshold, setPull]);

  return { pullDistance, refreshing };
}
