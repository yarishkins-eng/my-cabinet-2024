import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { balanceApi } from '../api/balance';
import { useAuthStore } from '../store/auth';
import { useCurrency } from '../hooks/useCurrency';
import { useHaptic } from '@/platform';
import { Spinner } from '@/components/ui/Spinner';
import { AnimatedCheckmark } from '@/components/ui/AnimatedCheckmark';
import { AnimatedCrossmark } from '@/components/ui/AnimatedCrossmark';
import { loadTopUpPendingInfo, clearTopUpPendingInfo } from '../utils/topUpStorage';
import { isPaidStatus, isFailedStatus } from '../utils/paymentStatus';
import { getSafeRedirectPath, resolveCheckoutReturn } from '../utils/safeRedirect';

// ── Constants ────────────────────────────────────────────────
const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 3_000;

/**
 * 🔴 Этап В-1 (мина EG). Запасной выход для состояний, где исход платежа ЕЩЁ НЕИЗВЕСТЕН
 * (ожидание и таймаут). Возвращает и адрес, и подпись — одним куском намеренно: разошлись
 * они ровно потому, что жили порознь. Кнопка была подписана «Перейти к балансу» и при любом
 * адресе возврата уводила на Главную.
 *
 * ⛔ На кассу отсюда НЕ уводим, хотя адрес возврата известен. Это сознательное решение этапа
 * Б-1, и оно остаётся верным: пока исход платежа неизвестен, касса покажет несвежий баланс и
 * прежнее «не хватает» — то есть соврёт увереннее, чем экран баланса, где видно фактическое
 * состояние счёта. Здесь чинится подпись, а не назначение.
 */
function neutralExit(returnTo: string | null): { path: string; labelKey: string } {
  return returnTo
    ? { path: '/', labelKey: 'balance.topUpResult.goToHome' }
    : { path: '/balance', labelKey: 'balance.topUpResult.goToBalance' };
}

// ── Sub-components ───────────────────────────────────────────

function AmountDisplay({ amountKopeks, label }: { amountKopeks: number; label: string }) {
  const { formatAmount, currencySymbol } = useCurrency();
  const amountRubles = amountKopeks / 100;

  return (
    <div className="mt-4 rounded-xl bg-dark-800/50 px-6 py-4">
      <p className="text-xs text-dark-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-dark-50">
        {formatAmount(amountRubles)} <span className="text-lg text-dark-400">{currencySymbol}</span>
      </p>
    </div>
  );
}

function PendingState({
  amountKopeks,
  onLeave,
  leaveLabelKey,
}: {
  amountKopeks: number | null;
  onLeave: () => void;
  leaveLabelKey: string;
}) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <Spinner className="h-16 w-16 border-[3px]" />
      <div>
        <h1 className="text-xl font-bold text-dark-50">
          {t('balance.topUpResult.awaitingPayment')}
        </h1>
        <p className="mt-2 text-sm text-dark-400">{t('balance.topUpResult.awaitingPaymentDesc')}</p>
      </div>
      {amountKopeks != null && amountKopeks > 0 && (
        <AmountDisplay amountKopeks={amountKopeks} label={t('balance.topUpResult.topUpAmount')} />
      )}
      {/* 🔴 Этап В-1 (мина EH): до этой кнопки экран держал человека ДЕСЯТЬ МИНУТ без единого
          выхода — только спиннер. Уйти отсюда безопасно: деньги зачисляет уведомление от
          платёжной системы, а не этот экран, и о зачислении бот пришлёт сообщение сам.
          Кнопка нарочно тихая: ждать здесь по-прежнему правильнее, чем уходить. */}
      {/* Ширина по содержимому, а не `w-full`: (1) на экране, чья работа — «подожди»,
          самым крупным органом управления был выход, вдвое шире суммы, ради которой человек
          здесь; (2) `w-full` ставила её ровно в тот прямоугольник, где через секунду
          появляется АКЦЕНТНАЯ кнопка следующего состояния, — палец, тянувшийся к серой
          «На главную», попадал бы в «Вернуться к покупке». Высота 44 px сохранена. */}
      <button
        type="button"
        onClick={onLeave}
        className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-dark-800/50 px-6 py-3 text-sm font-medium text-dark-200 transition-colors hover:bg-dark-700/50"
      >
        {t(leaveLabelKey)}
      </button>
    </motion.div>
  );
}

function SuccessState({
  amountKopeks,
  returnTo,
}: {
  amountKopeks: number | null;
  returnTo: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const checkoutReturn = resolveCheckoutReturn(returnTo);

  const handleDone = useCallback(() => {
    // 🔴 Этап Б-1: касса device-first (метка `from=checkout`) возвращает человека НА СЕБЯ —
    // ей нечему исполниться самой, корзины у неё нет.
    // Пришли из покупки/продления БЕЗ метки кассы (returnTo задан) → на Главную.
    // ⚠️ Этап В-1 поправил здесь ФОРМУЛИРОВКУ, не поведение. Прежняя гласила «корзина уже
    // авто-исполнилась на сервере» — и противоречила соседнему файлу, который импортирует этот
    // же экран: `safeRedirect.ts` прямо пишет, что у докупки устройств и трафика корзина
    // сохраняется без метки намерения и после пополнения НЕ исполняется. Верно второе.
    // Значит Главная здесь — не «там уже всё готово», а «там видно фактическое состояние»;
    // довести такую покупку — отдельный дефект и отдельная работа, и маскировать его подменой
    // адреса возврата нельзя (это же запрещает `safeRedirect.ts`).
    navigate(checkoutReturn ?? (returnTo ? '/' : '/balance'), { replace: true });
  }, [navigate, returnTo, checkoutReturn]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <AnimatedCheckmark />

      <div>
        <h1 className="text-xl font-bold text-dark-50">{t('balance.topUpResult.success')}</h1>
        <p className="mt-2 text-sm text-dark-400">{t('balance.topUpResult.successDesc')}</p>
      </div>

      {amountKopeks != null && amountKopeks > 0 && (
        <AmountDisplay amountKopeks={amountKopeks} label={t('balance.topUpResult.topUpAmount')} />
      )}

      <button
        type="button"
        onClick={handleDone}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-400"
      >
        {/* 🔴 Этап Б-1: для кассы «Перейти к подписке» — ложь ровно в ту секунду, когда деньги
            уже взяты: подписки ещё нет, пополнение ничего не оформило.
            🔴 Этап В-1 (мина EI): подпись Б-1 брала ключ кассы `deviceFirst.review`, а он же
            подписывает главную кнопку САМОЙ кассы. Человек нажимал «Перейти к оформлению» и
            видел «Перейти к оформлению» второй раз, ниже сгиба, — и не понимал, сработало ли
            первое нажатие. Своя подпись говорит, куда ведёт: назад к его покупке. */}
        {/* 🔴 Средняя ветка тоже переписана этапом В-1. Она брала ключ уведомлений
            `successNotification.goToSubscription`, а тот в персидском и китайском говорит
            «перейти к подписке» — при том что кнопка ведёт на Главную, где подписки может
            не быть. Это ровно мина EG, тремя строками ниже места, где EG чинили. Берём тот
            же собственный ключ, что и запасной выход: подпись и назначение сшиты в одном месте. */}
        {checkoutReturn
          ? t('balance.topUpResult.backToOrder')
          : returnTo
            ? t('balance.topUpResult.goToHome')
            : t('balance.topUpResult.goToBalance')}
      </button>
    </motion.div>
  );
}

function FailedState({
  amountKopeks,
  returnTo,
}: {
  amountKopeks: number | null;
  returnTo: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const checkoutReturn = resolveCheckoutReturn(returnTo);

  // 🔴 Этап В-1. Кнопка была подписана «Попробовать снова», а уводила на ОБЗОР баланса —
  // ни повтора, ни выбора способа, хотя текст над ней обещает ровно это. Ведём на выбор
  // способа оплаты, то есть туда, где подпись становится правдой. Адрес возврата едем с
  // собой: `TopUpMethodSelect` пробрасывает его дальше, и после удачной оплаты человек
  // вернётся к своей покупке, а не «на баланс».
  const handleTryAgain = useCallback(() => {
    const params = new URLSearchParams();
    const safeReturn = returnTo ? getSafeRedirectPath(returnTo) : '/';
    if (safeReturn !== '/') params.set('returnTo', safeReturn);
    // 🔴 Сумма едет с человеком. Без неё тот, кто шёл доплатить конкретную недостачу, набирает
    // её заново — и, ошибившись в меньшую сторону, возвращается на кассу всё с тем же
    // «не хватает». `TopUpMethodSelect` умеет пробрасывать `amount` дальше; в адресе он в
    // рублях, как его кладёт сама касса.
    if (amountKopeks != null && amountKopeks > 0) params.set('amount', String(amountKopeks / 100));
    const query = params.toString();
    navigate(`/balance/top-up${query ? `?${query}` : ''}`, { replace: true });
  }, [navigate, returnTo, amountKopeks]);

  const handleBackToOrder = useCallback(() => {
    navigate(checkoutReturn!, { replace: true });
  }, [navigate, checkoutReturn]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <AnimatedCrossmark />

      <div>
        <h1 className="text-xl font-bold text-dark-50">{t('balance.topUpResult.failed')}</h1>
        <p className="mt-2 text-sm text-dark-400">{t('balance.topUpResult.failedDesc')}</p>
      </div>

      {amountKopeks != null && amountKopeks > 0 && (
        <AmountDisplay amountKopeks={amountKopeks} label={t('balance.topUpResult.topUpAmount')} />
      )}

      {/* 🔴 Этап В-1 (мина EB): у экрана отказа был ОДИН выход — на баланс. Человек, который
          шёл доплатить за конкретную покупку и у которого не прошла оплата, оказывался без
          дороги обратно к своему заказу: заказ жив, выбор сохранён, а вернуться нечем.
          Дверь ставится только по метке кассы `from=checkout` — у соседних экранов покупки
          корзина не сохраняется, и возвращать их сюда было бы обещанием, которое не сбудется. */}
      <div className="flex w-full flex-col gap-3">
        {checkoutReturn && (
          <button
            type="button"
            onClick={handleBackToOrder}
            className="w-full rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-400"
          >
            {t('balance.topUpResult.backToOrder')}
          </button>
        )}
        <button
          type="button"
          onClick={handleTryAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-dark-800/50 px-6 py-3 text-sm font-medium text-dark-200 transition-colors hover:bg-dark-700/50"
        >
          {t('balance.topUpResult.tryAgain')}
        </button>
      </div>
    </motion.div>
  );
}

function TimeoutState({
  onRetry,
  onGoBack,
  goBackLabelKey,
}: {
  onRetry: () => void;
  onGoBack: () => void;
  goBackLabelKey: string;
}) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-6 text-center"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-dark-800/50">
        <svg
          className="h-10 w-10 text-dark-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-bold text-dark-50">{t('balance.topUpResult.timeout')}</h1>
        <p className="mt-2 text-sm text-dark-400">{t('balance.topUpResult.timeoutDesc')}</p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded-xl bg-accent-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-400"
        >
          {t('common.retry')}
        </button>
        <button
          type="button"
          onClick={onGoBack}
          className="w-full rounded-xl bg-dark-800/50 px-6 py-3 text-sm font-medium text-dark-200 transition-colors hover:bg-dark-700/50"
        >
          {/* 🔴 Этап В-1 (мина EG): подпись была зашита в «Перейти к балансу», а нажатие при
              заданном адресе возврата уводило на Главную. Теперь подпись приходит вместе с
              назначением из `neutralExit` — разойтись им больше нечем. */}
          {t(goBackLabelKey)}
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────

export default function TopUpResult() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const haptic = useHaptic();
  const pollStart = useRef(Date.now());
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const hapticFiredRef = useRef<'success' | 'error' | null>(null);
  const cleanedUpRef = useRef(false);

  // Load saved payment info from sessionStorage (once on mount)
  const [pendingInfo] = useState(() => loadTopUpPendingInfo());

  // Fallback: read method from query params (for external browser redirects where sessionStorage is unavailable)
  const methodFromUrl = searchParams.get('method');

  // Detect if user arrived via redirect with success param (no polling needed)
  const redirectStatus = searchParams.get('status') || searchParams.get('payment');
  const isRedirectSuccess = redirectStatus
    ? isPaidStatus(redirectStatus)
    : searchParams.get('success') === 'true';
  const isRedirectFailed = redirectStatus ? isFailedStatus(redirectStatus) : false;

  // Determine if we can poll by specific payment_id (need method + numeric payment_id)
  const parsedPaymentId = pendingInfo?.payment_id ? parseInt(pendingInfo.payment_id, 10) : NaN;
  // 🔴 Этап В-1. Раньше метка исхода в адресе ВЫКЛЮЧАЛА опрос сервера: экран объявлял
  // исход со слов платёжной системы и больше ничего не спрашивал. До этапа так почти не
  // случалось — возврат провайдера приземлялся во внешнем браузере, где человек не
  // авторизован, и экран физически не показывался. В-1 сделал этот путь ОСНОВНЫМ, а
  // заодно дал экрану всё, чтобы спросить: `payment_id` теперь переживает перезапуск
  // мини-приложения. Поэтому опрос идёт всегда, когда есть кого спрашивать.
  const canPollById = !!(pendingInfo?.method_id && !isNaN(parsedPaymentId));

  // Fallback: poll by method via /latest endpoint when no stored payment id
  const canPollByMethod = !canPollById && !!methodFromUrl;

  // Poll payment status by specific ID (primary path — sessionStorage available)
  const {
    data: paymentStatus,
    refetch,
    isError: byIdFailed,
  } = useQuery({
    queryKey: ['topup-status', pendingInfo?.method_id, parsedPaymentId],
    queryFn: () => balanceApi.getPendingPayment(pendingInfo!.method_id, parsedPaymentId),
    enabled: canPollById && !pollTimedOut,
    refetchInterval: (query) => {
      // 🔴 Этап В-1: проверка срока поднята НАД ранним выходом. Она стояла под ним, и пока
      // сервер не ответил ни разу, `payment` пуст — то есть десять минут не наступали НИКОГДА,
      // и экран таймаута с кнопкой «Повторить» был недостижим. До этапа это почти не всплывало:
      // метка исхода в адресе вообще выключала опрос. Теперь опрос идёт всегда, когда есть кого
      // спросить, и без этой перестановки человек остался бы в спиннере без конца.
      if (Date.now() - pollStart.current > MAX_POLL_MS) {
        setPollTimedOut(true);
        return false;
      }

      const payment = query.state.data;
      if (!payment) return POLL_INTERVAL_MS;

      if (payment.is_paid || isPaidStatus(payment.status) || isFailedStatus(payment.status)) {
        return false;
      }

      return POLL_INTERVAL_MS;
    },
    retry: 2,
  });

  // Poll payment status by method latest (fallback — external browser, no sessionStorage)
  const {
    data: latestPayment,
    refetch: refetchLatest,
    isError: byMethodFailed,
  } = useQuery({
    queryKey: ['topup-status-latest', methodFromUrl],
    queryFn: () => balanceApi.getLatestPayment(methodFromUrl!),
    enabled: canPollByMethod && !pollTimedOut,
    refetchInterval: (query) => {
      // 🔴 Этап В-1: проверка срока поднята НАД ранним выходом. Она стояла под ним, и пока
      // сервер не ответил ни разу, `payment` пуст — то есть десять минут не наступали НИКОГДА,
      // и экран таймаута с кнопкой «Повторить» был недостижим. До этапа это почти не всплывало:
      // метка исхода в адресе вообще выключала опрос. Теперь опрос идёт всегда, когда есть кого
      // спросить, и без этой перестановки человек остался бы в спиннере без конца.
      if (Date.now() - pollStart.current > MAX_POLL_MS) {
        setPollTimedOut(true);
        return false;
      }

      const payment = query.state.data;
      if (!payment) return POLL_INTERVAL_MS;

      if (payment.is_paid || isPaidStatus(payment.status) || isFailedStatus(payment.status)) {
        return false;
      }

      return POLL_INTERVAL_MS;
    },
    retry: 2,
  });

  // Merge both polling sources
  const effectivePayment = paymentStatus ?? latestPayment;

  const handleRetryPoll = useCallback(() => {
    pollStart.current = Date.now();
    setPollTimedOut(false);
    if (canPollById) {
      refetch();
    } else {
      refetchLatest();
    }
  }, [canPollById, setPollTimedOut, refetch, refetchLatest]);

  // 🔴 Этап В-1. Адрес возврата берётся из строки браузера, а если её нет — из памяти.
  // Строки нет ровно в том случае, ради которого этап и затеян: человек вернулся из банка
  // кнопкой провайдера, Телеграм запустил мини-приложение ЗАНОВО, и всё, что доехало, —
  // короткая метка запуска. Порядок именно такой: строка свежее памяти, если есть.
  const returnTo = searchParams.get('returnTo') ?? pendingInfo?.return_to ?? null;
  const exit = neutralExit(returnTo);

  const handleGoBack = useCallback(() => {
    // 🔴 Этап В-1 УБРАЛ отсюда `clearTopUpPendingInfo()`, и это не уборка, а починка.
    // Уйти с экрана — не значит «платёж закончился»: человек мог уже нажать оплату в банке.
    // А память о пополнении с этапа В-1 несёт ЕДИНСТВЕННЫЙ уцелевший адрес возврата на кассу:
    // когда он вернётся кнопкой платёжной системы, Телеграм запустит мини-приложение заново,
    // и строки браузера не будет. Стерев запись здесь, мы бы своими руками сломали то, ради
    // чего этап затеян. Запись и без того живёт не дольше 30 минут (`topUpStorage`) и
    // перезаписывается следующим пополнением, а на исходе платежа её гасят эффекты ниже.
    // Куда ведём: пришли из покупки (returnTo) → на Главную (корзина могла исполниться),
    // иначе на баланс. НЕ на кассу — и вот почему это остаётся верным после этапа В-1.
    //
    // 🔴 Этап Б-1 назвал три причины не уводить отсюда на кассу. Этап В-1 перечитал их и
    // оставил в силе ОДНУ — она же и была настоящей:
    // 🟢 живая: сюда попадают, пока исход платежа НЕИЗВЕСТЕН (ожидание или таймаут). Касса в
    //    этот момент покажет несвежий баланс и прежнее «не хватает» — то есть соврёт увереннее,
    //    чем экран баланса, где видно фактическое состояние счёта.
    // ~~«кнопка подписана „Перейти к балансу“, увести её на кассу — сделать подпись ложью»~~ —
    //    отпало: подпись больше не зашита, она приходит вместе с назначением из `neutralExit`.
    // ~~«ветка достижима только после десяти минут, сторожа на неё нет»~~ — отпало ДВАЖДЫ:
    //    этап В-1 сделал её достижимой сразу (выход из ожидания, мина EH) и закрыл сторожами.
    navigate(exit.path, { replace: true });
  }, [navigate, exit.path]);

  // Redirect to balance if absolutely no data source available
  useEffect(() => {
    if (!pendingInfo && !redirectStatus && !methodFromUrl) {
      navigate('/balance', { replace: true });
    }
  }, [pendingInfo, redirectStatus, methodFromUrl, navigate]);

  // Determine current visual state
  const amountKopeks = effectivePayment?.amount_kopeks ?? pendingInfo?.amount_kopeks ?? null;

  // 🔴 Этап В-1. Кто здесь главный — сервер, а не адресная строка.
  //
  // «Оплачено» экран объявляет ТОЛЬКО со слов сервера, пока сервера есть о чём спросить.
  // Иначе человек, вернувшийся из банка раньше, чем платёжная система прислала нам
  // подтверждение, читал «Баланс пополнен», шёл на кассу — и касса честно говорила ему
  // «не хватает». Второй платёж за ту же покупку в одно нажатие.
  //
  // «Не прошло» показываем сразу: увести человека на `failedUrl` — это уже решение
  // платёжной системы, и заставлять его смотреть в спиннер незачем. Но опрос при этом
  // НЕ останавливается, и если сервер скажет «оплачено», экран себя поправит. Так
  // закрывается обратный случай: провайдер вернул на «отказ», пока платёж ещё жив, а
  // потом деньги всё же подтвердились.
  const serverSaysPaid = Boolean(
    effectivePayment && (effectivePayment.is_paid || isPaidStatus(effectivePayment.status)),
  );
  const serverSaysFailed = Boolean(effectivePayment && isFailedStatus(effectivePayment.status));
  // 🔴 «Спросить сервер» и «сервер умеет ответить» — РАЗНЫЕ вещи, и первая версия правки их
  // путала. Статусный маршрут знает не все способы оплаты: для части из них он отдаёт 404
  // (`payment_verification_service.get_payment_record` их просто не разбирает). Человек,
  // заплативший таким способом, попадал бы в спиннер на десять минут вместо мгновенного
  // «Баланс пополнен» — то есть моя же починка ломала бы соседей. Если сервер ответить не
  // смог, слово провайдера снова становится единственным, как было до этапа.
  const serverCannotAnswer = canPollById ? byIdFailed : byMethodFailed;
  const canAskServer = (canPollById || canPollByMethod) && !serverCannotAnswer;

  const resolvedPaid = serverSaysPaid || (!canAskServer && isRedirectSuccess);
  const resolvedFailed = !resolvedPaid && (serverSaysFailed || isRedirectFailed);

  // 🔴 Этап В-1. Память гасим ТОЛЬКО когда ЭТОТ ЖЕ исход подтвердил сервер.
  //
  // Исход, пришедший лишь из адреса, — это слово, сказанное снаружи. После В-1 такой адрес
  // умеет собрать кто угодно: `t.me/<бот>?startapp=tup-platega-ok` откроет мини-приложение
  // прямо на этом экране. ⚠️ Обычно успеха он там не увидит: метка несёт способ, значит
  // сервера есть о чём спросить, и решает сервер. Но НЕ всегда — если сервер про этот платёж
  // ответить не смог (его нет, он чужой, он старше часа), слово адреса снова становится
  // единственным, и экран напишет «Баланс пополнен». Обещать здесь больше, чем есть, нельзя:
  // этот комментарий уже дважды протухал от следующей правки в том же этапе.
  // Опасно было другое: гашение памяти. У человека, чей платёж В ЭТУ МИНУТУ в полёте, чужая
  // ссылка стирала бы адрес возврата на кассу — то есть ломала бы ровно то, что чинит этап.
  // Не стереть безопасно: запись живёт не дольше ЧАСА (`topUpStorage`, срок поднят в этом же
  // этапе под платёжное окно провайдера) и перезаписывается следующим пополнением. Стереть по
  // чужому слову — нет.
  //
  // ⚠️ Забор именно «сервер сказал ТО ЖЕ», а не «сервер вообще ответил». Первую версию я
  // написал вторым способом, и сторож её поймал: сервер отвечал «ещё не оплачен», а экран
  // считал это подтверждением отказа и стирал запись.

  // Clean up storage and invalidate queries when payment resolves
  useEffect(() => {
    if (cleanedUpRef.current) return;
    if (resolvedPaid) {
      cleanedUpRef.current = true;
      if (serverSaysPaid) clearTopUpPendingInfo();
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
      });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      // 🔴 Этап Б-1: касса берёт баланс из СВОЕГО запроса, а он тут не гасился — вернувшийся
      // человек видел первым кадром старый баланс и прежнее «Не хватает N», то есть ровно то,
      // ради чего уходил платить.
      queryClient.invalidateQueries({ queryKey: ['device-first-options'] });
      refreshUser();
    } else if (resolvedFailed && serverSaysFailed) {
      // Отказ, о котором сказал только адрес, память не гасит: платёж может быть ещё жив,
      // а вместе с записью ушёл бы адрес возврата на кассу.
      cleanedUpRef.current = true;
      clearTopUpPendingInfo();
    }
  }, [resolvedPaid, resolvedFailed, serverSaysPaid, serverSaysFailed, queryClient, refreshUser]);

  // Haptic feedback on status resolution (fire once)
  // 🔴 Этап В-1: замок хранит, ЧТО именно уже отвиброировали. Раньше это был просто «уже»,
  // и телефон вибрировал «ошибкой» на отказ из адреса, а на пришедшее следом подтверждение
  // сервера («оплачено») молчал — то есть сообщал человеку ровно обратное произошедшему.
  // Ветка самокоррекции появилась в этом же этапе, значит и дефект наш.
  useEffect(() => {
    if (resolvedPaid && hapticFiredRef.current !== 'success') {
      hapticFiredRef.current = 'success';
      haptic.notification('success');
    } else if (resolvedFailed && hapticFiredRef.current === null) {
      hapticFiredRef.current = 'error';
      haptic.notification('error');
    }
  }, [resolvedPaid, resolvedFailed, haptic]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-dark-950 px-4">
      <div
        className="w-full max-w-md rounded-2xl border border-dark-800/50 bg-dark-900/50 p-8"
        aria-live="polite"
        aria-atomic="true"
      >
        {resolvedPaid ? (
          <SuccessState amountKopeks={amountKopeks} returnTo={returnTo} />
        ) : resolvedFailed ? (
          <FailedState amountKopeks={amountKopeks} returnTo={returnTo} />
        ) : pollTimedOut ? (
          <TimeoutState
            onRetry={handleRetryPoll}
            onGoBack={handleGoBack}
            goBackLabelKey={exit.labelKey}
          />
        ) : (
          <PendingState
            amountKopeks={amountKopeks}
            onLeave={handleGoBack}
            leaveLabelKey={exit.labelKey}
          />
        )}
      </div>
    </div>
  );
}
