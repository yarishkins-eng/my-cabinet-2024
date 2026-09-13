import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { subscriptionApi } from '@/api/subscription';
import { setDeviceHintSeen } from '@/utils/deviceHintTracking';
import type { Subscription } from '@/types';

export type TrialResolution = 'activate' | 'abandon_pending_invoice';

export interface TrialActivationInput {
  resolution: TrialResolution;
  expectedCheckoutId?: string;
}

/** Что сервер положил в `detail` ответа 409: код и человеческий текст, если они там были. */
export interface TrialConflict {
  code: string | null;
  message: string | null;
}

interface TrialActivationHandlers {
  /** 409 — сервер под блокировкой увидел не то состояние, что экран. Ключ идемпотентности уже сменён. */
  onConflict: (conflict: TrialConflict) => void | Promise<void>;
  /** Любой другой отказ; `messageKey` — ключ локали с честным текстом для этого отказа. */
  onError: (messageKey: string) => void;
}

function activationKey(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `trial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function responseOf(error: unknown): { status?: unknown; data?: { detail?: unknown } } | undefined {
  return (error as { response?: { status?: unknown; data?: { detail?: unknown } } })?.response;
}

export function isCheckoutStateConflict(error: unknown): boolean {
  return responseOf(error)?.status === 409;
}

function conflictOf(error: unknown): TrialConflict {
  const detail = responseOf(error)?.data?.detail;
  if (detail && typeof detail === 'object') {
    const { code, message } = detail as { code?: unknown; message?: unknown };
    return {
      code: typeof code === 'string' ? code : null,
      message: typeof message === 'string' ? message : null,
    };
  }
  return { code: null, message: null };
}

/**
 * 403 `subscription_restricted` — повтор не поможет, «попробуйте ещё раз» соврало бы; текст тот же,
 * что у кассы для этого же отказа (`deviceFirst.errorRestricted`). Узнаём по коду, а не по статусу:
 * 403 с другими кодами (канал, чёрный список) показывает свой экран поверх, и текст про
 * ограничение аккаунта там был бы неправдой. Остальное — общий отказ с повтором.
 */
export function trialActivationErrorKey(error: unknown): string {
  return conflictOf(error).code === 'subscription_restricted'
    ? 'deviceFirst.errorRestricted'
    : 'trialStart.activateError';
}

export function trialLandingPath(subscriptionId: number): string {
  return `/connection?sub=${subscriptionId}`;
}

const INVALIDATED_KEYS = [
  ['subscription'],
  ['subscriptions-list'],
  ['trial-info'],
  ['device-first-open-checkout'],
  ['balance'],
];

/**
 * Единственный клиентский путь активации пробного: карточка на Главной и экран `/trial`.
 *
 * Забор от активации поверх незавершённого счёта стоит на сервере: `POST /cabinet/subscription/trial`
 * при висящем счёте отвечает 409 `pending_checkout_requires_resolution` и ничего денежного не трогает.
 * Здесь — только ключ идемпотентности, защита от двойного нажатия, посадка после успеха и разбор отказа.
 */
export function useTrialActivation({ onConflict, onError }: TrialActivationHandlers) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef(activationKey());
  // `isPending` доезжает до кнопки через планировщик react-query (макротаск): второй тап в это
  // окно ушёл бы вторым POST с тем же ключом. Замок синхронный, снимается в `onSettled`.
  const inFlight = useRef(false);
  // Ответ может идти до 10 с (сервер ждёт панель). Если человек за это время ушёл с экрана
  // нижней навигацией или «назад», перебрасывать его на подключение из-под другого экрана
  // нельзя: пробный активирован, кэш погашен, а дальше он идёт сам.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Экран подключения — отдельный ленивый кусок кода, у новичка ещё не загруженный. Без
  // предзагрузки переход после успеха ждёт его, а React всё это время держит старый экран
  // с уже перечитанным состоянием («подписка есть», кнопка снова живая).
  useEffect(() => {
    import('@/pages/Connection').catch(() => undefined);
  }, []);

  const mutation = useMutation({
    mutationFn: (input: TrialActivationInput) =>
      subscriptionApi.activateTrial({
        resolution: input.resolution,
        expectedCheckoutId: input.expectedCheckoutId,
        idempotencyKey: idempotencyKey.current,
      }),
    onSuccess: (subscription: Subscription) => {
      // Человека ведём ровно туда, куда указывает подсказка «Подключить» на Главной —
      // саму подсказку для этой подписки гасим, иначе она всплывёт при возврате «назад».
      setDeviceHintSeen(subscription.id);
      // История [Главная, Подключение] на обоих входах — и с Главной, и с deep-link `/trial`
      // из бота: «назад» с экрана подключения ведёт на Главную с живой подпиской, а не на
      // исчерпанный экран пробного. Одиночный `replace` на подключение сломал бы «назад»
      // в веб-браузере (там кнопка экрана зовёт `navigate(-1)` без запасного пути).
      // Обе навигации применяются синхронно, потому что кабинет на классическом
      // `BrowserRouter`; data-router (`createBrowserRouter`) отменял бы первую второй.
      if (mounted.current) {
        navigate('/', { replace: true });
        navigate(trialLandingPath(subscription.id));
      }
      // Экран подключения читает свои запросы заново сам (`staleTime: 0`); остальные ключи
      // гасим не дожидаясь, чтобы Главная не мигнула новым состоянием перед уходом.
      void Promise.all(
        INVALIDATED_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
    onError: async (error: unknown) => {
      if (isCheckoutStateConflict(error)) {
        idempotencyKey.current = activationKey();
        await onConflict(conflictOf(error));
        return;
      }
      onError(trialActivationErrorKey(error));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const { mutate } = mutation;
  const start = useCallback(
    (input: TrialActivationInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutate(input);
    },
    [mutate],
  );

  // После успеха кнопка остаётся погашенной до размонтирования: между ответом и сменой
  // экрана она не должна снова звать «Активировать».
  return { start, isPending: mutation.isPending || mutation.isSuccess };
}
