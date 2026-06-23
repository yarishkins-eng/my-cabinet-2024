import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from '../api/subscription';
import { API } from '../config/constants';

export interface TrafficData {
  traffic_used_gb: number;
  traffic_used_percent: number;
  is_unlimited: boolean;
}

interface UseTrafficRefreshOptions {
  /** Подписка, чей трафик обновляем. undefined → бэк определит по пользователю. */
  subscriptionId: number | undefined;
  /** Запускать авто-обновление на маунте (есть ли активная подписка для обновления). */
  enabled: boolean;
}

/**
 * Окно «остывания» после обновления — в секундах. Раньше было зашито числом 30
 * в двух местах; теперь единый источник — `API.TRAFFIC_CACHE_MS`.
 */
const COOLDOWN_SEC = Math.ceil(API.TRAFFIC_CACHE_MS / 1000);

/**
 * Свежий трафик подписки: ручное/авто обновление через ручку refresh-traffic.
 *
 * Раньше эта логика была СКОПИРОВАНА в Dashboard и Subscription (включая хардкод
 * `30 * 1000` в детальной). Вынесено в один хук — единое поведение, один источник
 * тайминга. Не путать с `useTrafficZone` (цвет/зона по проценту).
 */
export function useTrafficRefresh({ subscriptionId, enabled }: UseTrafficRefreshOptions) {
  const queryClient = useQueryClient();
  const [trafficRefreshCooldown, setTrafficRefreshCooldown] = useState(0);
  const [trafficData, setTrafficData] = useState<TrafficData | null>(null);
  const hasAutoRefreshed = useRef(false);

  const storageKey = `traffic_refresh_ts_${subscriptionId ?? 'default'}`;

  const refreshTrafficMutation = useMutation({
    mutationFn: () => subscriptionApi.refreshTraffic(subscriptionId),
    onSuccess: (data) => {
      setTrafficData({
        traffic_used_gb: data.traffic_used_gb,
        traffic_used_percent: data.traffic_used_percent,
        is_unlimited: data.is_unlimited,
      });
      localStorage.setItem(storageKey, Date.now().toString());
      if (data.rate_limited && data.retry_after_seconds) {
        setTrafficRefreshCooldown(data.retry_after_seconds);
      } else {
        setTrafficRefreshCooldown(COOLDOWN_SEC);
      }
      // Инвалидируем подписку по id-ключу (совпадает со шторками/деталью). Если id
      // ещё неизвестен — предикатом (ловит и голый ['subscription'], и ['subscription', id]),
      // НИКОГДА не строим ['subscription', undefined].
      if (subscriptionId != null) {
        queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] });
      } else {
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'subscription',
        });
      }
    },
    onError: (error: {
      response?: { status?: number; headers?: { get?: (key: string) => string } };
    }) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.get?.('Retry-After');
        setTrafficRefreshCooldown(retryAfter ? parseInt(retryAfter, 10) : COOLDOWN_SEC);
      }
    },
  });

  // Обратный отсчёт «остывания».
  useEffect(() => {
    if (trafficRefreshCooldown <= 0) return;
    const timer = setInterval(() => {
      setTrafficRefreshCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [trafficRefreshCooldown]);

  // Авто-обновление на маунте (с учётом окна кэша) — один раз за сессию.
  useEffect(() => {
    if (!enabled) return;
    if (hasAutoRefreshed.current) return;
    hasAutoRefreshed.current = true;

    const lastRefresh = localStorage.getItem(storageKey);
    const now = Date.now();
    const cacheMs = API.TRAFFIC_CACHE_MS;

    if (lastRefresh && now - parseInt(lastRefresh, 10) < cacheMs) {
      const elapsed = now - parseInt(lastRefresh, 10);
      const remaining = Math.ceil((cacheMs - elapsed) / 1000);
      if (remaining > 0) setTrafficRefreshCooldown(remaining);
      return;
    }

    refreshTrafficMutation.mutate();
  }, [enabled, storageKey, refreshTrafficMutation]);

  return { trafficData, refreshTrafficMutation, trafficRefreshCooldown };
}
