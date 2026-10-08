import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';

import { balanceApi } from '../api/balance';
import { useCurrency } from '../hooks/useCurrency';
import { usePlatform } from '@/platform';
import { Button } from '@/components/primitives/Button';
import { CardIcon, ExclamationIcon, ExternalLinkIcon } from '@/components/icons';
import { useCloseOnSuccessNotification } from '../store/successNotification';
import { checkRateLimit, getRateLimitResetTime, RATE_LIMIT_KEYS } from '../utils/rateLimit';
import {
  loadConfirmedPurchase,
  saveConfirmedPurchase,
  saveTopUpPendingInfo,
} from '../utils/topUpStorage';
import { orderDevicesLabel, orderPeriodLabel } from '../utils/orderLabel';
import type { PaymentMethod, TopUpIntentRequest, TopUpResponse } from '../types';

/**
 * 🔴 ВК-16 (16в-1). Экран «Оплата заказа»: человек пришёл доплатить за КОНКРЕТНЫЙ заказ (кнопка «Доплатить» в боте
 * или в кассе), и доплата под заказ ему включена (`topup_intent_enabled`). Счёт выставляется при открытии — с
 * намерением, сумму считает СЕРВЕР; до банка одно нажатие «Оплатить». Сервер отвечает исходом (`intent_status`), и
 * у семи исходов из девяти нового счёта нет — экран показывает исход вместо оплаты (замысел v2, правило 6).
 *
 * ⛔ Обещание «оформится само» — только при `accepted` и `already_paying` (живой счёт с намерением): у `ordinary`
 * сервер выставил обычное пополнение, и подписку после него никто сам не оформит (правило 9).
 * ⛔ Отмены доплаты здесь нет (решение 3б): «Изменить заказ» — назад в кассу; новый счёт заменит старый.
 * ⛔ Копирования ссылки нет: возврат из банка живёт по номеру платежа, а не по новому `/topup` (мины EC, OY).
 */
interface TopUpOrderProps {
  method: PaymentMethod;
  initialOptionId: string | null;
  tariffName: string | null;
  periodDays: number;
  devices: number;
  /** Сумма из адреса — только для обычного пополнения (`ordinary`): при намерении сумму считает сервер. */
  amountKopeks: number;
  /** Касса с этим заказом (`from=checkout`) — «Изменить заказ» и адрес возврата экрана ожидания. */
  checkoutReturn: string;
}

const LIVE_INVOICE = new Set(['accepted', 'already_paying']);
/** Криптовалюта (Platega 13): подтверждение может прийти позже часа намерения, сервер отвечает обычным пополнением, а
 *  прежний счёт с намерением остаётся жив — два счёта на один заказ (план 16в-1, волна 2). На «Оплате заказа» её нет. */
const SLOW_OPTION_IDS = new Set(['13']);
const BLOCKED_ORDINARY = new Set(['restricted', 'account_erasure', 'unavailable']);

export default function TopUpOrder({
  method,
  initialOptionId,
  tariffName,
  periodDays,
  devices,
  amountKopeks,
  checkoutReturn,
}: TopUpOrderProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { formatAmount, currencySymbol } = useCurrency();
  const { openLink, openTelegramLink } = usePlatform();
  const options = (method.options ?? []).filter((option) => !SLOW_OPTION_IDS.has(option.id));
  const startOption = options.some((option) => option.id === initialOptionId)
    ? initialOptionId
    : (options.find((option) => /sbp|сбп/i.test(`${option.id} ${option.name}`))?.id ??
      options[0]?.id ??
      null);
  const [selectedOption, setSelectedOption] = useState<string | null>(startOption);
  // Счёт выставлен ЯВНОЙ сменой способа — прежний ещё оплачиваем у провайдера: предупреждаем не платить по нему.
  const [replacedOld, setReplacedOld] = useState(false);
  const [answer, setAnswer] = useState<TopUpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ответ «да» сервер не принял — повторять тот же запрос бессмысленно, ведём назад к заказу.
  const [rejected, setRejected] = useState(false);
  const leftToPayRef = useRef(false);
  // 🔴 Волна 1 (три линзы): каждый запрос экрана несёт ответ «да», если он был, а «Повторить» повторяет ИМЕННО
  // неудавшийся запрос — со сменой способа. Иначе после «да» сменить способ нельзя (сервер спросит снова, второе «да»
  // без смены способа вернёт старый счёт — круг), а повтор молча откатывает выбор на старый счёт.
  const confirmedRef = useRef<string | null>(loadConfirmedPurchase(periodDays, devices));
  const lastArgsRef = useRef<{ option: string | null; changeMethod: boolean }>({
    option: initialOptionId,
    changeMethod: false,
  });
  const paymentIdRef = useRef<string | null>(null);
  const sentConfirmationRef = useRef<string | null>(null);
  const autoStartedRef = useRef(false);
  // Своё «ждём ответ», а не `isPending` мутации: в StrictMode (`main.tsx`) наблюдатель мутации пересоздаётся при
  // двойном монтировании и остаётся «в ожидании» после ответа — экран держал бы «Готовим счёт…» поверх счёта.
  const [busy, setBusy] = useState(false);

  const money = (kopeks: number) => `${formatAmount(kopeks / 100)} ${currencySymbol}`;
  const what = [tariffName, orderPeriodLabel(t, periodDays), orderDevicesLabel(t, devices)]
    .filter(Boolean)
    .join(' · ');
  const resultPath = `/balance/top-up/result?returnTo=${encodeURIComponent(checkoutReturn)}`;

  const rememberPayment = useCallback(
    (data: TopUpResponse) => {
      if (!data.payment_id || data.amount_kopeks <= 0) return;
      paymentIdRef.current = data.payment_id;
      saveTopUpPendingInfo({
        amount_kopeks: data.amount_kopeks,
        method_id: method.id,
        method_name: method.name,
        payment_id: data.payment_id,
        created_at: Date.now(),
        return_to: checkoutReturn,
      });
    },
    [method.id, method.name, checkoutReturn],
  );

  const mutation = useMutation<
    TopUpResponse,
    unknown,
    { option: string | null; changeMethod: boolean; confirmedAt: string | null }
  >({
    mutationFn: ({ option, changeMethod, confirmedAt }) => {
      const intent: TopUpIntentRequest = { period_days: periodDays, devices };
      if (confirmedAt) intent.confirmed_purchase_at = confirmedAt;
      if (changeMethod) intent.change_method = true;
      sentConfirmationRef.current = confirmedAt;
      return balanceApi.createTopUp(amountKopeks, method.id, option ?? undefined, intent);
    },
    onSuccess: (data, variables) => {
      setReplacedOld(variables.changeMethod && data.intent_status === 'accepted');
      // Защита от отката 3а: сервер снова спросил ПРО ТУ ЖЕ покупку, на которую мы уже ответили «да», — значит
      // ответ он не принял. Задать тот же вопрос второй раз — замкнуть человека в круге.
      if (
        data.intent_status === 'already_fulfilled' &&
        sentConfirmationRef.current &&
        data.purchased_at === sentConfirmationRef.current
      ) {
        setAnswer(null);
        setRejected(true);
        setError(t('balance.topUpOrder.confirmRejected'));
        return;
      }
      if (data.intent_status === 'already_paid') {
        // Деньги по этому заказу уже пришли — ждём исход по номеру платежа, второй счёт не нужен.
        rememberPayment(data);
        navigate(resultPath, { replace: true });
        return;
      }
      // Скрытый счёт обычного пополнения (заказ оформить нельзя) в память ожидания не кладём.
      const blocked =
        data.intent_status === 'ordinary' && BLOCKED_ORDINARY.has(data.intent_reason ?? '');
      if (data.payment_url && !blocked) rememberPayment(data);
      if (data.intent_status === 'already_paying') {
        // Отмечен способ ЖИВОГО счёта; его нет в списке — не отмечен никакой, и любой выбор выставит новый счёт.
        const known = method.options?.some((option) => option.id === data.payment_option);
        setSelectedOption(known ? (data.payment_option ?? null) : null);
      }
      setAnswer(data);
    },
    onSettled: () => setBusy(false),
    // Ошибка — кнопку оплаты прежнего счёта рядом не оставляем: отмечен уже другой способ, и «Оплатить» повела бы
    // не туда. Сырой текст сервера (по-английски) человеку не показываем.
    onError: () => {
      setAnswer(null);
      setError(t('common.error'));
    },
  });

  const { mutate } = mutation;
  const request = useCallback(
    (option: string | null, changeMethod: boolean) => {
      setError(null);
      setRejected(false);
      lastArgsRef.current = { option, changeMethod };
      if (!checkRateLimit(RATE_LIMIT_KEYS.PAYMENT, 3, 30000)) {
        setAnswer(null);
        setError(
          t('balance.errors.rateLimit', {
            seconds: getRateLimitResetTime(RATE_LIMIT_KEYS.PAYMENT),
          }),
        );
        return;
      }
      setBusy(true);
      mutate({ option, changeMethod, confirmedAt: confirmedRef.current });
    },
    [mutate, t],
  );

  // Счёт — при открытии, один раз (`useRef` — против двойного эффекта StrictMode).
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    request(startOption, false);
  }, [request, startOption]);

  const goToResult = useCallback(() => {
    if (!paymentIdRef.current) return;
    navigate(resultPath, { replace: true });
  }, [navigate, resultPath]);

  // Вернулся из банка — на экран ожидания по номеру платежа, а не новый счёт (мина OY).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !leftToPayRef.current) return;
      goToResult();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [goToResult]);
  // Деньги пришли, пока экран открыт (уведомление по сокету): исход заказа покажет экран ожидания, не касса.
  useCloseOnSuccessNotification(goToResult);

  const handlePay = () => {
    const url = answer?.payment_url;
    if (!url) return;
    leftToPayRef.current = true;
    if (url.includes('t.me/')) openTelegramLink(url);
    else openLink(url);
  };

  const handlePickOption = (optionId: string) => {
    if (optionId === selectedOption || busy) return;
    setSelectedOption(optionId);
    // Живой счёт этого заказа уже есть — новый счёт другим способом только явным «сменить способ» (мина OR).
    // Ручной выбор способа — всегда «сменить способ»: без флага сервер отдал бы прежний живой счёт любым способом
    // (мина OR), в том числе после ошибки, когда ответа на экране уже нет. Тот же способ — тот же счёт.
    request(optionId, true);
  };

  const handleConfirmMore = () => {
    const purchasedAt = answer?.purchased_at;
    if (!purchasedAt) return;
    saveConfirmedPurchase(periodDays, devices, purchasedAt);
    confirmedRef.current = purchasedAt;
    // Вопрос мог прийти в ответ на смену способа — «да» повторяет её же.
    request(lastArgsRef.current.option, lastArgsRef.current.changeMethod);
  };
  const retry = () => request(lastArgsRef.current.option, lastArgsRef.current.changeMethod);

  // `ordinary` — сервер не принял намерение. Запрет покупок и удаление аккаунта — в поддержку; заказ нельзя
  // оформить — назад к заказу. Платить в этих случаях бессмысленно: оформить потом будет нечего.
  const ordinaryReason =
    answer?.intent_status === 'ordinary' ? (answer.intent_reason ?? null) : null;
  const ordinaryBlocked = BLOCKED_ORDINARY.has(ordinaryReason ?? '');

  const status = answer?.intent_status ?? null;
  const showsInvoice =
    !!answer?.payment_url &&
    !ordinaryBlocked &&
    (LIVE_INVOICE.has(status ?? '') || !status || status === 'ordinary');
  const promise = !!answer?.payment_url && LIVE_INVOICE.has(status ?? '');
  const price = answer?.price_kopeks ?? null;
  const toPay = showsInvoice ? answer!.amount_kopeks : null;
  const fromBalance = promise && price !== null && toPay !== null ? price - toPay : 0;
  const showOptions =
    options.length > 1 && (!answer || showsInvoice || status === 'invoice_not_created');
  const endDate = answer?.subscription_end_date
    ? new Date(answer.subscription_end_date).toLocaleDateString(i18n.language || 'ru', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const note = (text: string) => <p className="text-sm text-dark-300">{text}</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-4 pb-1">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/20 to-accent-600/20 text-accent-400">
          <CardIcon />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-dark-100">{t('balance.topUpOrder.title')}</h3>
          <p className="text-sm text-dark-400">{what}</p>
        </div>
      </div>

      {promise && price !== null && toPay !== null && (
        <dl className="space-y-2 rounded-2xl border border-dark-700/50 bg-dark-800/70 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-dark-400">{t('balance.topUpOrder.price')}</dt>
            <dd className="text-dark-100">{money(price)}</dd>
          </div>
          {fromBalance > 0 && (
            <div className="flex justify-between">
              <dt className="text-dark-400">{t('balance.topUpOrder.fromBalance')}</dt>
              <dd className="text-dark-100">−{money(fromBalance)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-dark-700/50 pt-2 font-semibold">
            <dt className="text-dark-200">{t('balance.topUpOrder.toPay')}</dt>
            <dd className="text-dark-50">{money(toPay)}</dd>
          </div>
        </dl>
      )}

      {showOptions && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-dark-400">{t('balance.paymentMethod')}</p>
          <div className="grid grid-cols-2 gap-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={selectedOption === option.id}
                disabled={busy}
                onClick={() => handlePickOption(option.id)}
                className={`min-h-[44px] rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 disabled:opacity-50 ${
                  selectedOption === option.id
                    ? 'bg-accent-500/15 text-accent-400 ring-2 ring-accent-500/40'
                    : 'border border-dark-700/50 bg-dark-800/70 text-dark-300 hover:bg-dark-700/70'
                }`}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && (
        <p role="status" className="text-sm text-dark-400">
          {t('balance.topUpOrder.preparing')}
        </p>
      )}

      {error && (
        <div className="space-y-3">
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 p-3"
          >
            <ExclamationIcon className="h-5 w-5 shrink-0 text-error-400" />
            <span className="text-sm text-error-400">{error}</span>
          </div>
          {rejected ? (
            <Button
              type="button"
              fullWidth
              size="lg"
              onClick={() => navigate(checkoutReturn, { replace: true })}
            >
              {t('balance.topUpOrder.backToOrder')}
            </Button>
          ) : (
            <Button type="button" fullWidth size="lg" variant="secondary" onClick={retry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}

      {!busy && answer && (
        <div className="space-y-3">
          {status === 'already_paying' && note(t('balance.topUpOrder.alreadyPaying'))}
          {status === 'ordinary' &&
            (ordinaryBlocked
              ? note(t(`balance.topUpResult.intent.reasons.${ordinaryReason}`))
              : note(t('balance.topUpOrder.ordinary')))}
          {status === 'ordinary' && showsInvoice && (
            <p className="text-sm font-semibold text-dark-100">
              {t('balance.topUpOrder.toPay')}: {money(answer.amount_kopeks)}
            </p>
          )}
          {ordinaryBlocked && ordinaryReason !== 'unavailable' && (
            <Button
              type="button"
              fullWidth
              size="lg"
              onClick={() => navigate('/support', { replace: true })}
            >
              {t('balance.topUpOrder.writeSupport')}
            </Button>
          )}
          {showsInvoice && (
            <Button
              type="button"
              fullWidth
              size="lg"
              onClick={handlePay}
              leftIcon={<ExternalLinkIcon className="h-5 w-5" />}
            >
              {promise
                ? t('balance.topUpOrder.pay', { amount: money(answer.amount_kopeks) })
                : t('balance.openPaymentPage')}
            </Button>
          )}
          {promise && note(t('balance.topUpOrder.autoPromise'))}
          {promise && replacedOld && note(t('balance.topUpOrder.oldInvoiceVoid'))}
          {status === 'already_paying' &&
            options.length > 1 &&
            note(t('balance.topUpOrder.otherMethodHint'))}
          {/* Окно может не уйти в фон (Телеграм на компьютере) или человек вернулся сам — экран денег не видит, а
              повторное открытие до вебхука показало бы «неоплаченный счёт». Выход к исходу по номеру платежа. */}
          {promise && (
            <button
              type="button"
              onClick={goToResult}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl px-2 text-sm font-medium text-dark-300 transition-colors hover:text-dark-100"
            >
              {t('balance.topUpOrder.paidAlready')}
            </button>
          )}

          {status === 'open_order' && (
            <>
              {note(t('balance.topUpOrder.openOrder'))}
              <Button
                type="button"
                fullWidth
                size="lg"
                onClick={() =>
                  navigate(
                    answer.checkout_public_id
                      ? `/subscription/purchase?checkout=${encodeURIComponent(answer.checkout_public_id)}`
                      : checkoutReturn,
                    { replace: true },
                  )
                }
              >
                {t('balance.topUpOrder.toMyOrder')}
              </Button>
            </>
          )}

          {status === 'order_on_review' && (
            <>
              {note(t('balance.topUpOrder.onReview'))}
              <Button
                type="button"
                fullWidth
                size="lg"
                onClick={() => navigate('/support', { replace: true })}
              >
                {t('balance.topUpOrder.writeSupport')}
              </Button>
            </>
          )}

          {status === 'already_fulfilled' && (
            <>
              {note(
                answer.period_days && answer.devices
                  ? t('balance.topUpOrder.fulfilledWhat', {
                      what: [
                        orderPeriodLabel(t, answer.period_days),
                        orderDevicesLabel(t, answer.devices),
                      ].join(' · '),
                    })
                  : t('balance.topUpOrder.fulfilledRecent'),
              )}
              {endDate && note(t('balance.topUpOrder.fulfilledUntil', { date: endDate }))}
              {answer.purchased_at && (
                <>
                  {note(
                    price !== null
                      ? t('balance.topUpOrder.morePeriodQuestion', { what, price: money(price) })
                      : t('balance.topUpOrder.morePeriodQuestionNoPrice', { what }),
                  )}
                  <Button type="button" fullWidth size="lg" onClick={handleConfirmMore}>
                    {t('balance.topUpOrder.morePeriodYes')}
                  </Button>
                </>
              )}
              <Button
                type="button"
                fullWidth
                size="lg"
                variant="secondary"
                onClick={() => navigate('/', { replace: true })}
              >
                {t('balance.topUpOrder.morePeriodNo')}
              </Button>
            </>
          )}

          {status === 'balance_covers' && (
            <>
              {note(t('balance.topUpOrder.balanceCovers'))}
              <Button
                type="button"
                fullWidth
                size="lg"
                onClick={() => navigate(checkoutReturn, { replace: true })}
              >
                {t('balance.topUpOrder.backToOrder')}
              </Button>
            </>
          )}

          {status === 'invoice_not_created' && (
            <>
              {note(t('deviceFirst.errorProviderNoInvoice'))}
              <Button type="button" fullWidth size="lg" variant="secondary" onClick={retry}>
                {t('common.retry')}
              </Button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate(checkoutReturn, { replace: true })}
        className="flex min-h-[44px] items-center justify-center rounded-xl px-2 text-sm font-medium text-dark-400 transition-colors hover:text-dark-200"
      >
        {t('balance.topUpOrder.changeOrder')}
      </button>
    </div>
  );
}
