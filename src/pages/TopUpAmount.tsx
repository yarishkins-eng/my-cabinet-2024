import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';

import { balanceApi } from '../api/balance';
import { useCurrency } from '../hooks/useCurrency';
import { checkRateLimit, getRateLimitResetTime, RATE_LIMIT_KEYS } from '../utils/rateLimit';
import { useCloseOnSuccessNotification } from '../store/successNotification';
import { useHaptic, usePlatform } from '@/platform';
import { staggerContainer, staggerItem } from '@/components/motion/transitions';
import { Button } from '@/components/primitives/Button';
import type { PaymentMethod, PaymentMethodOption } from '../types';
import BentoCard from '../components/ui/BentoCard';
import { saveTopUpPendingInfo } from '../utils/topUpStorage';
import { getSafeRedirectPath } from '../utils/safeRedirect';
import { copyToClipboard } from '@/utils/clipboard';
import {
  CardIcon,
  CheckIcon,
  CopyIcon,
  CryptoIcon,
  ExclamationIcon,
  ExternalLinkIcon,
  SparklesIcon,
  StarIcon,
} from '@/components/icons';

const getMethodIcon = (methodId: string) => {
  const id = methodId.toLowerCase();
  if (id.includes('stars')) return <StarIcon />;
  if (id.includes('crypto') || id.includes('ton') || id.includes('usdt')) return <CryptoIcon />;
  return <CardIcon />;
};

const getPreferredOptionId = (options?: PaymentMethod['options']) => {
  if (!options || options.length === 0) return null;

  const sbpOption = options.find((option) => {
    const normalizedId = option.id.toLowerCase();
    const normalizedName = option.name.toLowerCase();
    return (
      normalizedId.includes('sbp') ||
      normalizedName.includes('сбп') ||
      normalizedName.includes('sbp')
    );
  });

  return sbpOption?.id ?? options[0].id;
};

const sortOptionsWithSbpFirst = (options?: PaymentMethod['options']) => {
  if (!options || options.length <= 1) return options ?? [];

  const isPreferredOption = (option: PaymentMethodOption) => {
    const normalizedId = option.id.toLowerCase();
    const normalizedName = option.name.toLowerCase();
    return (
      normalizedId.includes('sbp') ||
      normalizedName.includes('сбп') ||
      normalizedName.includes('sbp')
    );
  };

  return [...options].sort((left, right) => {
    const leftIsPreferred = isPreferredOption(left);
    const rightIsPreferred = isPreferredOption(right);

    if (leftIsPreferred === rightIsPreferred) return 0;
    return leftIsPreferred ? -1 : 1;
  });
};

export default function TopUpAmount() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { methodId } = useParams<{ methodId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol, convertAmount, convertToRub, targetCurrency } =
    useCurrency();
  const { openInvoice, openTelegramLink, openLink, platform } = usePlatform();
  const haptic = useHaptic();
  const inputRef = useRef<HTMLInputElement>(null);
  // Пользователь реально нажал «Открыть страницу оплаты» (ушёл платить). Защищает Вариант 2:
  // не уводим на экран результата и не реагируем на WS, пока ссылку не открыли.
  const paymentLinkOpenedRef = useRef(false);

  const returnTo = searchParams.get('returnTo');
  const initialAmountRubles = searchParams.get('amount')
    ? parseFloat(searchParams.get('amount')!)
    : undefined;
  // 🔴 Этап Б-2. Касса приводит сюда со СВОИМ способом — числом провайдера (`option=2`), а не
  // ключом (`sbp`): числа и есть словарь этого экрана. Предвыбираем только то, что реально
  // лежит в `method.options`. ⛔ Молча подставлять чужое нельзя: `getPreferredOptionId` при
  // непопадании ставит СБП, то есть человек, выбравший карту, ушёл бы платить по СБП.
  const requestedOptionId = searchParams.get('option');
  const pickOptionId = useCallback(
    (methodOptions?: PaymentMethod['options']) => {
      if (requestedOptionId && methodOptions?.some((option) => option.id === requestedOptionId)) {
        return requestedOptionId;
      }
      return getPreferredOptionId(methodOptions);
    },
    [requestedOptionId],
  );

  // The amount screen also works after a direct link or page reload, where
  // React Query has no in-memory cache yet.
  const {
    data: paymentMethods,
    isLoading: isPaymentMethodsLoading,
    isError: isPaymentMethodsError,
    refetch: refetchPaymentMethods,
  } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
  });
  const method = paymentMethods?.find((paymentMethod) => paymentMethod.id === methodId);

  const handleNavigateBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handleSuccess = useCallback(() => {
    // Если пользователь ушёл по платёжной ссылке — НЕ перехватываем навигацию здесь (WS мог
    // прийти, пока он в браузере): возврат обработает visibilitychange → экран результата.
    if (paymentLinkOpenedRef.current) return;
    // 🔴 Этап Б-2, мина EC — живой дефект, доехавший на боевой этапом Б-1.
    // Отсюда есть ДВА выхода, которые минуют `/balance/top-up/result`, а это единственное
    // место во всём кабинете, где гасится кэш кассы (`TopUpResult.tsx`, эффект `resolvedPaid`):
    //   · человек скопировал ссылку и заплатил в браузере или на компьютере — `handleCopyUrl`
    //     метку ухода не ставит, поэтому WS-успех уходит сюда, а не на экран результата;
    //   · оплата звёздами: `starsPaymentMutation.onSuccess` зовёт `handleSuccess` напрямую.
    // Итог был один и тот же: человек заплатил и вернулся на кассу с ПРЕЖНИМ «Не хватает N» —
    // ровно то, что этап Б-1 объявил закрытым.
    // ⛔ Лечить это взведением `paymentLinkOpenedRef` внутри копирования НЕЛЬЗЯ: ту же метку
    // читает слушатель `visibilitychange` ниже, и тогда ЛЮБОЕ переключение приложения после
    // копирования уводило бы на экран результата — десять минут «Проверяем статус оплаты» за
    // платёж, которого не было. Гасим кэш здесь, у самого выхода: побочек нет вовсе.
    queryClient.invalidateQueries({ queryKey: ['balance'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['device-first-options'] });
    queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
    });
    // returnTo arrives via query string — validate as an in-app path before
    // navigate(), otherwise an absolute or encoded URL produces ugly
    // path artefacts in the URL bar. The validator returns '/' for invalid
    // input; treat that case as "no returnTo" and use the /balance default.
    const safe = getSafeRedirectPath(returnTo);
    navigate(returnTo && safe !== '/' ? safe : '/balance', { replace: true });
  }, [navigate, queryClient, returnTo]);

  // Keyboard: Escape to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleNavigateBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNavigateBack]);

  // Auto-redirect when success notification appears (e.g., balance topped up via WebSocket)
  useCloseOnSuccessNotification(handleSuccess);

  const getInitialAmount = (): string => {
    if (!initialAmountRubles || initialAmountRubles <= 0) return '';
    const converted = convertAmount(initialAmountRubles);
    return targetCurrency === 'IRR' || targetCurrency === 'RUB'
      ? Math.ceil(converted).toString()
      : converted.toFixed(2);
  };

  const initialDisplayAmount = getInitialAmount();
  const [amount, setAmount] = useState(initialDisplayAmount);
  const [error, setError] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(
    pickOptionId(method?.options),
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // If the current method is no longer available, return to method selection
  // while preserving the intended amount and return path.
  useEffect(() => {
    if (paymentMethods && !method) {
      const params = new URLSearchParams();
      const amount = searchParams.get('amount');
      const rt = searchParams.get('returnTo');
      if (amount) params.set('amount', amount);
      if (rt) params.set('returnTo', rt);
      const qs = params.toString();
      navigate(`/balance/top-up${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [paymentMethods, method, navigate, searchParams]);

  useEffect(() => {
    if (!method?.options || method.options.length === 0) {
      if (selectedOption !== null) {
        setSelectedOption(null);
      }
      return;
    }

    // Ручной выбор человека сюда не попадает: пока выбранный вариант существует, условие
    // ложно. То есть метка кассы задаёт НАЧАЛЬНЫЙ способ, а не спорит с ним дальше.
    const optionExists = method.options.some((option) => option.id === selectedOption);
    if (!optionExists) {
      setSelectedOption(pickOptionId(method.options));
    }
  }, [method?.id, method?.options, pickOptionId, selectedOption]);

  const starsPaymentMutation = useMutation({
    mutationFn: (amountKopeks: number) => balanceApi.createStarsInvoice(amountKopeks),
    onSuccess: async (data) => {
      if (!data.invoice_url) {
        setError(t('balance.errors.noPaymentLink'));
        return;
      }
      try {
        const status = await openInvoice(data.invoice_url);
        if (status === 'paid') {
          haptic.notification('success');
          setError(null);
          handleSuccess();
        } else if (status === 'failed') {
          haptic.notification('error');
          setError(t('wheel.starsPaymentFailed'));
        }
      } catch (e) {
        setError(t('balance.errors.generic', { details: String(e) }));
      }
    },
    onError: (err: unknown) => {
      haptic.notification('error');
      const axiosError = err as { response?: { data?: { detail?: string }; status?: number } };
      setError(axiosError?.response?.data?.detail || t('balance.errors.invoiceFailed'));
    },
  });

  const topUpMutation = useMutation<
    {
      payment_id: string;
      payment_url?: string;
      invoice_url?: string;
      amount_kopeks: number;
      amount_rubles: number;
      status: string;
      expires_at: string | null;
    },
    unknown,
    number
  >({
    mutationFn: (amountKopeks: number) => {
      if (!method) throw new Error('Method not loaded');
      return balanceApi.createTopUp(amountKopeks, method.id, selectedOption || undefined);
    },
    onSuccess: (data) => {
      const redirectUrl = data.payment_url || data.invoice_url;
      if (redirectUrl) {
        // Save payment info for the result page (do BEFORE possible redirect,
        // иначе после window.location.href этот код не выполнится).
        if (method && data.payment_id) {
          const methodKey = method.id.toLowerCase().replace(/-/g, '_');
          const displayName =
            t(`balance.paymentMethods.${methodKey}.name`, { defaultValue: '' }) || method.name;
          saveTopUpPendingInfo({
            amount_kopeks: data.amount_kopeks,
            method_id: method.id,
            method_name: displayName,
            payment_id: data.payment_id,
            created_at: Date.now(),
          });
        }

        // open_url_direct: seamless флоу как при покупке подарка.
        // window.location.href внутри Telegram MiniApp WebView навигирует
        // в том же контейнере без открытия внешнего браузера. После
        // оплаты return_url возвращает на /balance/top-up/result.
        //
        // t.me/ URL (Telegram Stars, CryptoBot) — всегда через нативный
        // handler (openInvoice / openTelegramLink в setPaymentUrl-ветке).
        // Stars уже отбит раньше через starsPaymentMutation, здесь — защита
        // на случай CryptoBot и других Telegram-deep-link провайдеров.
        // toLowerCase для устойчивости к редким провайдерам, которые могут вернуть
        // URL в нестандартном регистре. Также покрываем tg:// scheme на всякий случай.
        const lowerUrl = redirectUrl.toLowerCase();
        const isTelegramDeepLink =
          lowerUrl.startsWith('https://t.me/') ||
          lowerUrl.startsWith('http://t.me/') ||
          lowerUrl.startsWith('tg://');
        if (method?.open_url_direct && !isTelegramDeepLink) {
          window.location.href = redirectUrl;
          return;
        }

        setPaymentUrl(redirectUrl);
      }
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '';
      setError(
        detail.includes('not yet implemented') ? t('balance.useBot') : detail || t('common.error'),
      );
    },
  });

  // Auto-focus input (only on desktop — mobile keyboard hides bottom nav)
  useEffect(() => {
    if (platform === 'telegram') return;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [platform]);

  // Возврат в мини-апп после ухода на оплату (ссылка уже сгенерирована) — НЕ «зависаем» на
  // «Ссылка готова», а уводим на экран результата: он опросит статус платежа и при успехе
  // покажет результат (корзина к этому моменту уже авто-исполнилась на сервере). returnTo
  // пробрасываем, чтобы со страницы результата вернуть на нужный экран (Главная).
  useEffect(() => {
    if (!paymentUrl) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Уводим на результат только если пользователь реально ушёл платить (открыл ссылку),
      // иначе при простом сворачивании/возврате потеряли бы экран с ещё не открытой ссылкой.
      if (!paymentLinkOpenedRef.current) return;
      const rt = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      navigate(`/balance/top-up/result${rt}`, { replace: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [paymentUrl, returnTo, navigate]);

  // 🔴 Этап Б-2. Эти производные и `handleSubmit` подняты ВЫШЕ ранних возвратов ради одного:
  // автосабмит по метке кассы — это эффект, а хук нельзя объявить после `return`. Значения
  // считаются с `?.`, а сам `handleSubmit` первой строкой выходит, если способа ещё нет; ниже
  // по файлу ранний возврат гарантирует `method`, поэтому разметка не изменилась ни в чём.
  const hasOptions = Boolean(method?.options && method.options.length > 0);
  const orderedOptions = sortOptionsWithSbpFirst(method?.options);
  const minRubles = (method?.min_amount_kopeks ?? 0) / 100;
  const maxRubles = (method?.max_amount_kopeks ?? 0) / 100;
  const methodKey = (method?.id ?? '').toLowerCase().replace(/-/g, '_');
  const isStarsMethod = methodKey.includes('stars');
  const methodName =
    t(`balance.paymentMethods.${methodKey}.name`, { defaultValue: '' }) || method?.name || '';

  const handleSubmit = () => {
    if (!method) return;
    setError(null);
    setPaymentUrl(null);
    inputRef.current?.blur();

    if (!checkRateLimit(RATE_LIMIT_KEYS.PAYMENT, 3, 30000)) {
      setError(
        t('balance.errors.rateLimit', { seconds: getRateLimitResetTime(RATE_LIMIT_KEYS.PAYMENT) }),
      );
      return;
    }
    if (hasOptions && !selectedOption) {
      setError(t('balance.errors.selectMethod'));
      return;
    }
    const amountCurrency = parseFloat(amount);
    if (isNaN(amountCurrency) || amountCurrency <= 0) {
      setError(t('balance.errors.enterAmount'));
      return;
    }
    const amountRubles = convertToRub(amountCurrency);
    if (amountRubles < minRubles || amountRubles > maxRubles) {
      setError(t('balance.errors.amountRange', { min: minRubles, max: maxRubles }));
      return;
    }

    // Сохраняем canonical RUB amount если юзер НЕ редактировал префилл.
    // Display-rounding в `.toFixed(2)` теряет точность: 150₽ при rate=90.66 → "1.65" USD
    // (округление вниз с 1.6545), back-конвертация даёт 1.65 × 90.66 = 149.589₽ < 150₽
    // → юзер не может купить подписку 150₽. С canonical RUB обходим FX round-trip.
    //
    // Math.ceil для не-RUB локалей покрывает остаточные sub-копеечные ошибки
    // floating-point, когда юзер реально вводит свой amount.
    const userEditedAmount = amount.trim() !== initialDisplayAmount.trim();
    let amountKopeks: number;
    if (!userEditedAmount && initialAmountRubles && initialAmountRubles > 0) {
      amountKopeks = Math.round(initialAmountRubles * 100);
    } else if (targetCurrency === 'RUB') {
      amountKopeks = Math.round(amountRubles * 100);
    } else {
      amountKopeks = Math.ceil(amountRubles * 100);
    }
    if (isStarsMethod) {
      starsPaymentMutation.mutate(amountKopeks);
    } else {
      topUpMutation.mutate(amountKopeks);
    }
  };

  // 🔴 Этап Б-2, автосоздание счёта по метке кассы (`auto=1`). Экран остаётся тем же самым,
  // просто человек не нажимает «Получить ссылку» на сумме, которую он не выбирал и не может
  // изменить осмысленно — её посчитала касса.
  // ⛔ Банк САМИ НЕ ОТКРЫВАЕМ: `openLink` вне живого нажатия режется блокировщиком всплывающих
  // окон и отказывает МОЛЧА, а метку «ушёл платить» взводит только ручной `handleOpenPayment`.
  // Автооткрытие сломало бы возврат: человек вернулся бы из банка на застывший «Счёт создан»
  // и решил, что не заплатил. Один живой тап «Перейти к оплате» остаётся.
  // Две защёлки, и обе обязательны:
  //   · `useRef` — против `React.StrictMode` (`main.tsx`), где эффект исполняется дважды и
  //     сжёг бы две попытки из трёх у `checkRateLimit(PAYMENT, 3, 30000)`;
  //   · снятие `auto` из адреса через `replace` — против кнопки «назад». Мина DZ: вернувшийся
  //     с пополнения человек одним нажатием «назад» снова попадает сюда, и без снятия параметра
  //     этот вход выстрелил бы ВТОРЫМ счётом на ту же сумму. `replace` переписывает ту самую
  //     запись истории, в которую «назад» и приводит.
  const autoSubmittedRef = useRef(false);
  // `handleSubmit` пересоздаётся каждый рендер, и держать его в зависимостях эффекта значило бы
  // гонять эффект вхолостую на каждом нажатии клавиши в поле суммы. Свежую ссылку хранит ref,
  // обновляемый отдельным эффектом ВЫШЕ по объявлению — React исполняет эффекты в этом порядке,
  // поэтому к моменту автосабмита в ref лежит функция текущего рендера, а не прошлого.
  const submitRef = useRef(handleSubmit);
  useEffect(() => {
    submitRef.current = handleSubmit;
  });
  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (searchParams.get('auto') !== '1') return;
    // Ждём способы: без них `handleSubmit` вышел бы первой строкой, а попытку уже потратил.
    if (!method) return;
    // Ждём предвыбор варианта — иначе получим свой же отказ «выберите способ».
    if (hasOptions && !selectedOption) return;
    // Без суммы в адресе автосабмит показал бы красное «Введите сумму», которую человек не
    // вводил. Такой вход к нам приходить не должен вовсе, но проверка стоит копейку.
    if (!initialAmountRubles || initialAmountRubles <= 0) return;
    autoSubmittedRef.current = true;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('auto');
    setSearchParams(nextParams, { replace: true });
    submitRef.current();
  }, [hasOptions, initialAmountRubles, method, searchParams, selectedOption, setSearchParams]);

  if (isPaymentMethodsError) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-dark-400">{t('common.error')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => refetchPaymentMethods()}>
          {t('balance.topUp')}
        </Button>
      </div>
    );
  }

  if (isPaymentMethodsLoading || !method) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  const quickAmounts = (method.quick_amounts ?? [])
    .map((amountKopeks) => amountKopeks / 100)
    .filter((amountRubles) => amountRubles >= minRubles && amountRubles <= maxRubles);
  const currencyDecimals = targetCurrency === 'IRR' || targetCurrency === 'RUB' ? 0 : 2;
  const getQuickValue = (rub: number) =>
    targetCurrency === 'IRR'
      ? Math.round(convertAmount(rub)).toString()
      : convertAmount(rub).toFixed(currencyDecimals);
  const isPending = topUpMutation.isPending || starsPaymentMutation.isPending;

  const handleOpenPayment = () => {
    if (!paymentUrl) return;
    paymentLinkOpenedRef.current = true;
    if (paymentUrl.includes('t.me/')) {
      openTelegramLink(paymentUrl);
    } else {
      openLink(paymentUrl);
    }
  };

  const handleCopyUrl = async () => {
    if (!paymentUrl) return;
    try {
      await copyToClipboard(paymentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed silently
    }
  };

  return (
    <motion.div
      className="mx-auto max-w-lg space-y-5"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header icon and payment range */}
      <motion.div variants={staggerItem} className="flex items-center gap-4 pb-1">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
            isStarsMethod
              ? 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20 text-yellow-400'
              : 'bg-gradient-to-br from-accent-500/20 to-accent-600/20 text-accent-400'
          }`}
        >
          <div className="flex h-7 w-7 items-center justify-center">{getMethodIcon(method.id)}</div>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold text-dark-100">{t('balance.topUpBalance')}</h3>
          <p className="text-sm text-dark-400">
            {methodName} · {formatAmount(minRubles, 0)} – {formatAmount(maxRubles, 0)}{' '}
            {currencySymbol}
          </p>
        </div>
      </motion.div>

      {/* Payment options (if any) */}
      {hasOptions && orderedOptions.length > 0 && (
        <motion.div variants={staggerItem} className="space-y-2">
          <label className="text-sm font-medium text-dark-400">{t('balance.paymentMethod')}</label>
          <div className="grid grid-cols-2 gap-2">
            {orderedOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedOption(opt.id)}
                className={`relative rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                  selectedOption === opt.id
                    ? 'bg-accent-500/15 text-accent-400 ring-2 ring-accent-500/40'
                    : 'border border-dark-700/50 bg-dark-800/70 text-dark-300 hover:bg-dark-700/70'
                }`}
              >
                {opt.name}
                {selectedOption === opt.id && (
                  <span className="absolute right-1.5 top-1.5">
                    <span className="block h-2 w-2 rounded-full bg-accent-500" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Amount input and a full-width primary action keep the next step
          legible even for longer localized labels. */}
      <motion.div variants={staggerItem} className="space-y-2">
        <label className="text-sm font-medium text-dark-400">{t('balance.enterAmount')}</label>
        <div
          className={`relative rounded-2xl transition-all duration-200 ${
            isInputFocused
              ? 'bg-dark-800 ring-2 ring-accent-500/50'
              : 'border border-dark-700/50 bg-dark-800/70'
          }`}
        >
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            enterKeyHint="done"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="0"
            className="h-14 w-full bg-transparent px-4 pr-12 text-xl font-bold text-dark-100 placeholder:text-dark-600 focus:outline-none"
            autoComplete="off"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-semibold text-dark-500">
            {currencySymbol}
          </span>
        </div>
        <Button
          type="button"
          fullWidth
          size="lg"
          leftIcon={<SparklesIcon className="h-4 w-4" />}
          onClick={handleSubmit}
          disabled={!amount || parseFloat(amount) <= 0}
          loading={isPending}
        >
          {isStarsMethod
            ? t('balance.topUpAction')
            : method.open_url_direct
              ? t('balance.goToPayment')
              : t('balance.getPaymentLink')}
        </Button>
      </motion.div>

      {/* Quick amount buttons */}
      {quickAmounts.length > 0 && (
        <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quickAmounts.map((a) => {
            const val = getQuickValue(a);
            const isSelected = amount === val;
            return (
              <BentoCard
                key={a}
                as="button"
                type="button"
                onClick={() => {
                  setAmount(val);
                  inputRef.current?.blur();
                }}
                hover
                glow={isSelected}
                className={`flex flex-col items-center justify-center px-2 py-3 ${
                  isSelected ? 'border-accent-500/50 bg-accent-500/10' : ''
                }`}
              >
                <span
                  className={`text-base font-bold ${isSelected ? 'text-accent-400' : 'text-dark-200'}`}
                >
                  {formatAmount(a, 0)}
                </span>
                <span
                  className={`mt-0.5 text-xs ${isSelected ? 'text-accent-400/70' : 'text-dark-500'}`}
                >
                  {currencySymbol}
                </span>
              </BentoCard>
            );
          })}
        </motion.div>
      )}

      {/* Error message */}
      {error && (
        <motion.div
          variants={staggerItem}
          className="flex items-center gap-2 rounded-xl border border-error-500/20 bg-error-500/10 p-3"
        >
          <ExclamationIcon className="h-5 w-5 shrink-0 text-error-400" />
          <span className="text-sm text-error-400">{error}</span>
        </motion.div>
      )}

      {/* Payment link display - shown when URL is received */}
      {paymentUrl && (
        <motion.div
          variants={staggerItem}
          className="space-y-3 rounded-2xl border border-success-500/20 bg-success-500/10 p-4"
        >
          <div className="flex items-center gap-2 text-success-400">
            <CheckIcon className="h-5 w-5" />
            <span className="font-semibold">{t('balance.paymentReady')}</span>
          </div>

          <p className="text-sm text-dark-400">{t('balance.clickToOpenPayment')}</p>

          <Button
            type="button"
            fullWidth
            size="lg"
            onClick={handleOpenPayment}
            leftIcon={<ExternalLinkIcon className="h-5 w-5" />}
          >
            {t('balance.openPaymentPage')}
          </Button>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 rounded-lg border border-dark-700/50 bg-dark-800/70 px-3 py-2">
              <p className="truncate text-xs text-dark-500">{paymentUrl}</p>
            </div>
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`shrink-0 rounded-lg p-2.5 transition-colors ${
                copied
                  ? 'bg-success-500/20 text-success-400'
                  : 'bg-dark-800/70 text-dark-400 hover:bg-dark-700 hover:text-dark-200'
              }`}
              title={t('common.copy')}
            >
              {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
