import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { balanceApi } from '@/api/balance';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstCommitResponse,
  type DeviceFirstOptions,
  type DeviceFirstPaymentAttempt,
} from '@/api/deviceFirst';
import { XIcon } from '@/components/icons';
import { getGlassColors } from '@/utils/glassTheme';
import { closedCartCopy, operatorReviewCopy } from '@/utils/deviceFirstMoney';
import { useTheme } from '@/hooks/useTheme';
import { usePlatform } from '@/platform';
import { copyToClipboard } from '@/utils/clipboard';

// 🔴 Этап Б-2. Внешние деньги у device-first входят ровно одним каналом: список способов
// оплаты заказа зашит как `{wallet, platega}` (`device_first_checkout_service.py:1154`).
// Поэтому и доплата ведёт к тому же провайдеру — иначе `provider_code` с кассы попал бы
// на экран чужого способа, где такого варианта нет.
const CHECKOUT_TOP_UP_METHOD_ID = 'platega';

interface Props {
  options: DeviceFirstOptions;
  initialCheckoutId?: string | null;
  fixtureCheckout?: DeviceFirstCheckout | null;
  fixtureMethods?: Array<{ key: string; provider_code: number }>;
}

export function DeviceFirstConfigurator({
  options,
  initialCheckoutId,
  fixtureCheckout,
  fixtureMethods,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const { openLink } = usePlatform();
  const g = getGlassColors(isDark);
  const paymentLinkOpenedRef = useRef(false);
  const paymentDeclinedRef = useRef(false);
  const [paymentDeclined, setPaymentDeclined] = useState(false);
  const markLeavingToPay = useCallback(() => {
    // 🔴 Оба выхода наружу обязаны отмечаться одинаково: и кнопка оплаты, и «скопировать
    // ссылку». Пока это знал только первый, человек, оплативший ПО СКОПИРОВАННОЙ ссылке,
    // возвращался на экран, который не перечитывал заказ и уже замолчал по порогу, — а
    // подпись под кнопкой обещала ему «заказ обновится сам». Нашла волна ревью, не я.
    paymentLinkOpenedRef.current = true;
    // 🔴 Мина EW (наша, нашли три проверки волны 2). Плашка «Оплата не прошла» — это НОВОСТЬ
    // от платёжной системы, а не свойство заказа. Человек пошёл платить снова — прежний отказ
    // перестал быть последним, что мы о нём знаем. Не сбросив здесь, мы показывали бы «оплата
    // не прошла» поверх работающей кнопки оплаты тому, кто как раз платит.
    setPaymentDeclined(false);
    // Опрос статуса затухает через 2 минуты (`:365`), а окно оплаты по СБП — 30–41 минута.
    // Пока документ умирал, это было незаметно: возврат с оплаты был новой загрузкой и
    // отсчёт начинался заново. Оставив документ живым, мы обязаны перевзвести отсчёт сами.
    pollStartedAt.current = Date.now();
  }, []);
  const openProviderLink = useCallback(
    (url: string) => {
      // 🔴 Пункт 1 реза 22.08.2026. Раньше здесь стоял `window.location.assign`: документ
      // мини-аппа заменялся страницей провайдера прямо в вебвью Телеграма, и оттуда СБП не
      // мог передать управление приложению банка. Теперь просим Телеграм открыть ссылку
      // отдельной поверхностью — наш документ остаётся жить за ней.
      // Это приём НАШЕГО ЖЕ экрана пополнения (`TopUpAmount.tsx:396-404`), а не выдумка.
      // Замер на боевом 22.08, обе руки — мини-приложение, Platega, возврат в https-кабинет,
      // то есть отличается ровно способ ухода: пополнение через `openLink` 42 оплаты из 82
      // (51%), касса через `assign` 5 из 23 (22%), точный тест Фишера p = 0,017.
      markLeavingToPay();
      try {
        openLink(url);
      } catch {
        // 🔴 Отказ опенера НЕ должен ронять экран: до правки бросок из обработчика клика
        // уходил в `window` и засчитывался как unhandled error — набор оставался зелёным по
        // тестам, а `npm test` выходил с кодом 1 и ронял `verify.yml`.
        // Видимый выход из молчаливого отказа один и он рядом — кнопка «скопировать ссылку».
      }
    },
    [markLeavingToPay, openLink],
  );
  const [period, setPeriod] = useState(
    options.default_period_days ?? options.period_options?.[0] ?? 30,
  );
  const [devices, setDevices] = useState(options.device_options?.[0] ?? 1);
  // Legacy showcase drafts (and pre-payment legacy-deposit confirmations) can
  // only arrive from a deprecated bundle: they drain into a fresh local
  // configuration after an explicit cancellation. A fused-born direct
  // confirmation is a live order and stays the working checkout.
  const [checkout, setCheckout] = useState<DeviceFirstCheckout | null>(
    fixtureCheckout && !isShowcaseDraft(fixtureCheckout) ? fixtureCheckout : null,
  );
  const [legacyDraft, setLegacyDraft] = useState<DeviceFirstCheckout | null>(
    fixtureCheckout && isShowcaseDraft(fixtureCheckout) ? fixtureCheckout : null,
  );
  // The confirmation step is local UI state: no durable order exists until a
  // payment button is pressed.
  const [confirmation, setConfirmation] = useState(false);
  const [repriced, setRepriced] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  // 🔴 Три состояния, а не два. Раньше отказ писал `false` в состояние, которое и так
  // `false`: React делал bail-out, ре-рендера не было, и отказ был НЕОТЛИЧИМ от «я не нажал».
  // Кнопка задумана как выход из молчаливого отказа опенера — и сама отказывала молча.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // 🔴 Таймер успеха хранится, чтобы его можно было ОТМЕНИТЬ. Без этого догорающий
  // таймер от прошлого удачного копирования стирал надпись об отказе — то есть ровно
  // тот инвариант, который эта правка и обещает («отказ остаётся на экране»). Нашёл ревьюер.
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [existingPaymentAttempt, setExistingPaymentAttempt] =
    useState<DeviceFirstPaymentAttempt | null>(null);
  const checkoutUiState = checkout?.ui_state;
  const modalOpen = fixtureCheckout === undefined && checkoutUiState === 'awaiting_payment';
  const [methodKey, setMethodKey] = useState('sbp');
  // 🔴 РЕК-8а. «Мы не открыли оплату, и вот почему» — состояние живёт до ухода с экрана
  // подтверждения. Без него остановка автозапуска молчалива, и человек читает её как поломку.
  const [autostartHeldForWallet, setAutostartHeldForWallet] = useState(false);
  const autostartPeriodParam = searchParams.get('period');
  const autostartDevicesParam = searchParams.get('devices');
  const nativeLaunchMethod = searchParams.get('method');
  const nativeAutostart = searchParams.get('autostart') === '1';
  // New bot pay buttons deep-link a checkout-free launch: the full selection
  // arrives as URL parameters instead of a pre-created checkout id.
  const fusedAutostart =
    fixtureCheckout === undefined &&
    !initialCheckoutId &&
    nativeAutostart &&
    !!nativeLaunchMethod &&
    !!autostartPeriodParam &&
    !!autostartDevicesParam;
  const nativeLaunchRef = useRef<string | null>(null);
  const restoredHandledRef = useRef<string | null>(null);
  const pollStartedAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const consumeNativeLaunchParams = useCallback(() => {
    if (fixtureCheckout !== undefined) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('period');
    nextParams.delete('devices');
    nextParams.delete('method');
    nextParams.delete('autostart');
    // Этап Б-1: метка возврата с пополнения одноразовая ровно так же, как launch-запрос.
    nextParams.delete('from');
    setSearchParams(nextParams, { replace: true });
  }, [fixtureCheckout, searchParams, setSearchParams]);
  // 🔴 Мина AQ. Платёжная система возвращает отказавшего с меткой `payment=failed`
  // (`utils/telegramStartParam.ts` превращает `co_<id>_fail` в этот параметр). До сих пор его
  // на этом маршруте не читал НИКТО — параметр доезжал и пропадал впустую.
  // Зачем он нужен, если заказ и так закроется: закрывает его не возврат человека, а вебхук
  // или сверка. Пока они не сработали, строка остаётся `awaiting_payment`, и человек видит
  // живую кнопку «Перейти к оплате» и НИ СЛОВА о том, что банк только что отказал.
  // ⛔ Метку снимаем с адреса сразу и держим в ref: иначе она переживёт перезагрузку и будет
  // объявлять отказ по заказу, который человек к тому времени уже оплатил.
  useEffect(() => {
    if (fixtureCheckout !== undefined) return;
    if (paymentDeclinedRef.current) return;
    if (searchParams.get('payment') !== 'failed') return;
    paymentDeclinedRef.current = true;
    setPaymentDeclined(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('payment');
    setSearchParams(nextParams, { replace: true });
  }, [fixtureCheckout, searchParams, setSearchParams]);

  const acceptCheckout = useCallback(
    (next: DeviceFirstCheckout) => {
      if (isShowcaseDraft(next)) {
        // A showcase draft born by an old bundle (restored by id or resumed via
        // the open-checkout recovery): route it to the drain screen instead of
        // making it the working checkout.
        setLegacyDraft(next);
        consumeNativeLaunchParams();
        return;
      }
      setConfirmation(false);
      setRepriced(false);
      setCheckout(next);
      if (next.ui_state !== 'awaiting_payment') setConfirmAbandon(false);
      if (fixtureCheckout === undefined) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('checkout', next.id);
        // The Telegram launch query is deliberately single-use.  The durable
        // checkout id remains for recovery, while browser Back/reload cannot
        // automatically submit another payment command.
        nextParams.delete('period');
        nextParams.delete('devices');
        nextParams.delete('method');
        nextParams.delete('autostart');
        // The initial C1 → C2 transition is a real user navigation, so Back
        // returns to the configuration. State refreshes for that same checkout
        // replace instead of growing the history on every poll.
        setSearchParams(nextParams, { replace: searchParams.has('checkout') });
      }
    },
    [consumeNativeLaunchParams, fixtureCheckout, searchParams, setSearchParams],
  );
  const returnToConfiguration = useCallback(() => {
    // Keep the person's selection, but leave the currently displayed order.
    // This is navigation only: a live provider invoice remains resumable
    // until an explicit abandonment or a completed different configuration.
    deviceFirstApi.clearCreateIntents();
    setActionError(null);
    // 🔴 Мина EW. Без этого отказ по ЗАКРЫТОМУ заказу переезжал на следующий, ни разу не
    // оплаченный счёт: состояние ставилось один раз и не сбрасывалось ничем, а компонент
    // между заказами не размонтируется.
    setPaymentDeclined(false);
    setExistingPaymentAttempt(null);
    setConfirmAbandon(false);
    setRepriced(false);
    setConfirmation(false);
    setCheckout(null);
    setLegacyDraft(null);
    if (fixtureCheckout === undefined) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('checkout');
      setSearchParams(nextParams, { replace: true });
    }
  }, [fixtureCheckout, searchParams, setSearchParams]);

  const restoredCheckout = useQuery({
    queryKey: ['device-first-checkout', initialCheckoutId],
    queryFn: () => deviceFirstApi.get(initialCheckoutId!),
    enabled: fixtureCheckout === undefined && !!initialCheckoutId && !checkout,
    // 🔴 Этап В-1: было `retry: false`, и одной сетевой осечки хватало, чтобы экран сказал
    // ЗАПЛАТИВШЕМУ «деньги без подтверждения не списаны» и предложил создать новый расчёт.
    // Раньше сюда попадали редко и своими руками; теперь это АВТОМАТИЧЕСКОЕ приземление после
    // оплаты картой — то есть холодный старт вебвью, где первая попытка запроса срывается
    // чаще всего. Запрос читающий, повтор безопасен.
    retry: 2,
  });
  useEffect(() => {
    const restored = restoredCheckout.data;
    if (!restored || restoredHandledRef.current === restored.id) return;
    restoredHandledRef.current = restored.id;
    // acceptCheckout itself routes a restored legacy showcase draft to the
    // drain screen; a fused-born direct confirmation resumes through the
    // local confirmation wired to the row's data.
    acceptCheckout(restored);
  }, [acceptCheckout, restoredCheckout.data]);
  useEffect(() => {
    // Browser Back from C2 removes the checkout query parameter. Preserve the
    // selected term/device state, but return the person to C1 rather than
    // leaving an invisible checkout dialog open in component state.
    if (fixtureCheckout === undefined && !initialCheckoutId) {
      setCheckout(null);
      setLegacyDraft(null);
      setActionError(null);
      setExistingPaymentAttempt(null);
      setConfirmAbandon(false);
    }
  }, [fixtureCheckout, initialCheckoutId]);

  // 🔴 Мина X, вторая половина. Заказ закрывается — сам ли (мина F, провайдер) или
  // человеком, — и его уводит на экран выбора. Но выбор он делал сам: срок и число
  // устройств лежат в строке заказа. Запоминаем их здесь, а применяет эффект
  // синхронизации ниже: он единственный дожидается настоящих опций, а при холодной
  // загрузке по адресу возврата строка приходит РАНЬШЕ них, и проверять цену прямо
  // тут было бы рано — вариант молча признавался бы непродающимся.
  // Без этого человек оформлял 5 устройств на 90 дней, а видел первый попавшийся
  // вариант — то есть свой текущий лимит на месяц — и мог не заметить подмены.
  const preferredSelectionRef = useRef<{ period: number; devices: number } | null>(null);
  const rememberSelection = useCallback((row: DeviceFirstCheckout | null | undefined) => {
    if (!row) return;
    preferredSelectionRef.current = {
      period: row.period_days,
      devices: row.selected_device_limit,
    };
  }, []);

  // 🔴 Этап Б-1, посев выбора после пополнения. Человек ушёл доплачивать ЗА ЭТУ покупку —
  // вернуть ему её срок и число устройств — уважение к его работе, а не навязывание: цена
  // всё равно берётся свежая, деньги списываются только явным нажатием.
  // ⛔ Сеем в `preferredSelectionRef`, а НЕ в `setPeriod`/`setDevices`. Прямой посев в
  // состояние воскрешает мину X: при холодной загрузке опции ещё не пришли, и эффект
  // синхронизации ниже честно нормализовал бы посеянный выбор в первый попавшийся вариант —
  // человек, вернувшийся с деньгами за 5 устройств на 90 дней, молча получил бы 1 на 30.
  // Ref же дожидается настоящих опций и применяется, только если `priceFor` находит вариант.
  // ⛔ И НЕ открываем подтверждение автоматически: гард того эффекта первой строкой делает
  // `if (confirmation || …) return`, то есть на открытом подтверждении выбор не применился бы
  // НИКОГДА, и на денежном экране человек увидел бы «Недоступно» сразу после успешной доплаты.
  // Он возвращается на экран выбора со своей конфигурацией и свежей ценой — и подтверждает сам.
  const topUpReturnSeedRef = useRef(false);
  useEffect(() => {
    if (topUpReturnSeedRef.current) return;
    if (fixtureCheckout !== undefined) return;
    if (searchParams.get('from') !== 'checkout') return;
    topUpReturnSeedRef.current = true;
    const seededPeriod = Number(searchParams.get('period'));
    const seededDevices = Number(searchParams.get('devices'));
    if (
      Number.isInteger(seededPeriod) &&
      seededPeriod > 0 &&
      Number.isInteger(seededDevices) &&
      seededDevices > 0
    ) {
      preferredSelectionRef.current = { period: seededPeriod, devices: seededDevices };
    }
    // Заряд из адреса снимаем сразу: иначе `?period=&devices=` переживёт перезагрузку и
    // будет тихо восстанавливать старый выбор поверх нового при каждом `setSearchParams`.
    consumeNativeLaunchParams();
  }, [consumeNativeLaunchParams, fixtureCheckout, searchParams]);

  const priceFor = useCallback(
    (days: number, deviceLimit: number) =>
      options.price_matrix
        ?.find((row) => row.period_days === days)
        ?.prices.find((item) => item.device_limit === deviceLimit),
    [options.price_matrix],
  );
  const price = priceFor(period, devices);

  // A fused-born direct order interrupted between its pay-time birth and the
  // payment attempt resumes through the local confirmation, but wired to the
  // row's own data: the person confirms exactly the amount the server will
  // charge on the same-config resume (the server ignores the optimistic price
  // token for a resume and always invoices the row's immutable total).
  const resumedConfirmation = checkout?.ui_state === 'confirmation' ? checkout : null;

  useEffect(() => {
    // 🔴 Мина X. Тот же приём, что и для способа оплаты (поиск по `availableKeys`): зашитое начальное
    // значение нельзя оставлять, если сервер такого варианта не даёт.
    // `useState` выше берёт умолчание ОДИН раз, а при холодной загрузке по адресу
    // возврата с Platega (`?checkout=`) опции ещё не пришли, и в выбор попадает
    // «1 устройство» из запасного `?? 1`. Такого варианта нет ни в одном тарифе
    // (`device_first_eligibility.py:50-53` запрещает значения ниже базового лимита),
    // поэтому цена не находится НИ ДЛЯ ОДНОГО срока: все четыре рисуются
    // «Недоступно», «Итого» пустое, кнопка мертва, и подсказки нет. Экран при этом
    // лечится одним касанием по карточке устройства — но об этом ничто не говорит,
    // а с клавиатуры до карточек не добраться: без выбранной ни одна не в tab-порядке.
    // Владелец поймал это после отмены заказа; сюда же приводит уход с экрана закрытого
    // заказа кнопкой «Начать новый расчёт» (`startNewQuote`), то есть каждая брошенная
    // корзина, оплачивавшаяся через СБП.
    // ⚠️ Прежняя редакция ссылалась на «автоматический возврат при отмене счёта провайдером» —
    // того эффекта больше нет, он снят этапом AR 25.08.2026 (см. комментарий на его месте).
    // 🔴 Гард обязателен: пока открыто подтверждение или показан заказ, под кнопкой
    // оплаты стоит конкретная сумма, и молча поменять там ВЫБОР — значит показать цену
    // другой конфигурации.
    // ⚠️ Честно про границу: гард держит выбор, а не цену. Если сервер пришлёт новые
    // цены на ТУ ЖЕ конфигурацию (например после `wallet_insufficient`, который сам
    // инвалидирует опции), сумма под кнопкой пересчитается и без нас. Деньги при этом
    // защищены сервером: он сверяет `expected_tariff_total_kopeks`.
    if (confirmation || resumedConfirmation || checkout) return;
    const preferred = preferredSelectionRef.current;
    if (preferred && priceFor(preferred.period, preferred.devices)) {
      // Вариант человека ещё продаётся — возвращаем именно его, а не первый попавшийся.
      preferredSelectionRef.current = null;
      setPeriod(preferred.period);
      setDevices(preferred.devices);
      return;
    }
    const availableDevices = options.device_options ?? [];
    if (availableDevices.length && !availableDevices.includes(devices)) {
      setDevices(availableDevices[0]);
    }
    const availablePeriods = options.period_options ?? [];
    if (availablePeriods.length && !availablePeriods.includes(period)) {
      setPeriod(
        availablePeriods.includes(options.default_period_days ?? -1)
          ? options.default_period_days!
          : availablePeriods[0],
      );
    }
  }, [
    checkout,
    confirmation,
    resumedConfirmation,
    devices,
    period,
    priceFor,
    options.device_options,
    options.period_options,
    options.default_period_days,
  ]);
  const confirmPeriodDays = resumedConfirmation?.period_days ?? period;
  const confirmDeviceLimit = resumedConfirmation?.selected_device_limit ?? devices;
  const confirmTotalKopeks =
    resumedConfirmation?.tariff_total_kopeks ?? price?.price_kopeks ?? null;
  const confirmBalanceKopeks =
    options.balance_kopeks ?? resumedConfirmation?.balance_kopeks ?? null;
  // The server rejects an unknown selection with invalid_selection before any
  // resume, so the payment CTA exists only while the selection is priced.
  const confirmSelectionAvailable = Boolean(priceFor(confirmPeriodDays, confirmDeviceLimit));
  // 🔴 Этап Б-1: недостача — ЧЕСТНАЯ разница, её печатают в сводке. Этап Б-2 отделил от неё
  // ВТОРОЕ число — `topUpChargeKopeks`, сумму, которая реально уйдёт в счёт. Они разные, и
  // смешивать их нельзя: в сводке человек должен видеть, сколько ему не хватает, а на кнопке —
  // сколько с него возьмут. Раньше числа совпадали по построению, потому что второго не было.
  const confirmShortageKopeks =
    confirmTotalKopeks === null ? 0 : Math.max(0, confirmTotalKopeks - (confirmBalanceKopeks ?? 0));
  // 🔴 Этап Б-2, ветка нулевого баланса. У человека без денег на балансе строки «Баланс 0 ₽» и
  // «Не хватает 429 ₽» и кнопка пополнения — это ТРИ упоминания денег, которых у него нет, над
  // работающей кнопкой прямой оплаты. Гасим их одним признаком, чтобы они не могли разойтись.
  const hasWallet = (confirmBalanceKopeks ?? 0) > 0;
  const walletCoversTotal =
    confirmTotalKopeks !== null && (confirmBalanceKopeks ?? 0) >= confirmTotalKopeks;

  const statusQuery = useQuery({
    queryKey: ['device-first-checkout', checkout?.id],
    queryFn: () => deviceFirstApi.get(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      !!checkout &&
      ['awaiting_payment', 'processing', 'provisioning'].includes(checkout.ui_state),
    refetchInterval: (query) => {
      const isDirectSettlement = checkout?.settlement_mode === 'direct_purchase_v2';
      const providerDeadline =
        isDirectSettlement && checkout.provider_invoice_expires_at
          ? Date.parse(checkout.provider_invoice_expires_at)
          : Number.NaN;
      // A direct invoice remains customer-visible for the provider-owned
      // payment window, not an arbitrary two-minute browser interval. The
      // server remains authoritative; this merely lets an open screen notice
      // its canonical terminal result without asking the person to reload.
      if (Number.isFinite(providerDeadline)) {
        if (Date.now() > providerDeadline + 30_000) return false;
      } else if (
        // 🔴 Пункт 4.11а. Здесь стояло исключение для `direct_purchase_v2`, и оно означало
        // «прямой счёт опрашиваем вечно». Держалось оно на предположении, что у прямого
        // счёта всегда есть срок провайдера, — а у боевых СБП-счетов срока нет ни у одного
        // (`expiresIn` Platega не присылает). Раньше это было незаметно: авто-редирект
        // уничтожал документ вместе с опросом. Убрав редирект, экран остался бы стучать в
        // сервер бесконечно. Счёт без срока теперь замолкает по тому же порогу, что и все
        // остальные; ручной путь — кнопка «Обновить статус» — никуда не делся.
        // 🔴 Но ТОЛЬКО экран счёта. Этот же запрос обслуживает `processing` и `provisioning`
        // — экраны ПОСЛЕ оплаты, где человек ждёт выдачи VPN. Заглушить их порогом значило бы
        // заплатившему показывать «Настраиваем…» вечно, а подсказки про «Обновить статус»
        // там нет. Для них поведение остаётся ровно прежним.
        (!isDirectSettlement || checkout?.ui_state === 'awaiting_payment') &&
        Date.now() - pollStartedAt.current > 2 * 60 * 1000
      ) {
        return false;
      }
      const updates = query.state.dataUpdateCount;
      return updates > 12 ? 10_000 : updates > 4 ? 5_000 : 2_500;
    },
  });
  useEffect(() => {
    if (!statusQuery.data) return;
    setCheckout(statusQuery.data);
    // 🔴 Опрос пишет строку МИМО `acceptCheckout`, поэтому единственным, кто чистил
    // `actionError` на переходе `awaiting_payment → cancelled`, был снятый этапом
    // авто-возврат. Без этой строки поверх объяснения «Предыдущий счёт закрыт» вставала
    // прежняя техническая ошибка («не оплачивайте повторно; обновите статус»), и экран
    // давал два противоположных указания разом. Гасим ровно на терминальном переходе:
    // ошибка относилась к счёту, которого больше нет.
    // ⚠️ СУЖЕНО волной 2. Было «любое не-`awaiting_payment`», и это уносило защиту
    // «не оплачивайте повторно» на `expired`/`failed`/`conflict`, где своего объяснения нет и
    // экран падает в запасной текст. Гасим ровно там, где этап поставил ЗАМЕНУ: закрытый
    // провайдером счёт со своим объяснением. Остальные состояния ведут себя как прежде.
    if (statusQuery.data.terminal_reason?.startsWith('provider_terminal:')) setActionError(null);
  }, [statusQuery.data]);

  const methods = useQuery({
    queryKey: ['device-first-payment-methods'],
    queryFn: deviceFirstApi.paymentMethods,
    initialData: fixtureMethods ? { methods: fixtureMethods } : undefined,
    enabled:
      fixtureMethods === undefined &&
      (confirmation ||
        !!resumedConfirmation ||
        fusedAutostart ||
        (!!checkout && checkout.ui_state === 'awaiting_payment')),
  });
  useEffect(() => {
    const availableKeys = methods.data?.methods.map((method) => method.key) ?? [];
    // A user can have only card or crypto enabled. Never submit the hard-coded
    // initial SBP value when it is not among the methods supplied by the server.
    if (availableKeys.length && !availableKeys.includes(methodKey)) {
      setMethodKey(availableKeys[0]);
    }
  }, [methodKey, methods.data]);

  // 🔴 Этап Б-2. Минимум провайдера кабинет ДО СИХ ПОР не получал на кассе, и комментарий
  // этапа Б-1 («кабинет этого числа не получает вовсе») был верен лишь про
  // `deviceFirstApi.paymentMethods` — тот отдаёт только `key` и `provider_code`. Балансный
  // эндпоинт отдаёт `min_amount_kopeks`, и это ТОТ ЖЕ минимум, которым сервер отбивает
  // `/topup` (`bot-code/app/cabinet/routes/balance.py:332-336`). Запрос ТОТ ЖЕ, что у
  // `Balance` и `TopUpAmount` (`['payment-methods']`), поэтому кэш общий и лишней сети нет,
  // если человек уже был на балансе. Экран им не блокируется: пока числа нет, кнопка живая,
  // сумма — сырая разница, а автосоздание счёта просто не включается.
  const topUpMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
    // 🔴 Прогрев начинается на экране ВЫБОРА, а не на подтверждении. Нашёл прогон сценария:
    // тапнул «Доплатить» раньше, чем ответил запрос, — и короткий путь не собирается
    // (`option`/`auto` в адрес не кладутся), то есть выигрыш этапа доставался только тем, кто
    // читает медленно. Запрос лёгкий, кэш общий с экраном баланса, витрина закрыта.
    enabled: fixtureCheckout === undefined,
  });
  const checkoutTopUpProvider = topUpMethods.data?.find(
    (method) => method.id === CHECKOUT_TOP_UP_METHOD_ID,
  );
  // ⚠️ Минимум берём ИМЕННО у того провайдера, к которому ведём, а не «первый попавшийся»:
  // чужой минимум — это чужое число, и оно разошлось бы с отказом сервера ровно в тот день,
  // когда владелец включит второго провайдера.
  const topUpProviderMinKopeks = checkoutTopUpProvider?.min_amount_kopeks ?? null;
  // Сумма счёта = недостача, округлённая ВВЕРХ до рубля и поднятая до минимума провайдера
  // (он тоже округляется вверх — иначе на кнопке появились бы копейки, которых нет в адресе).
  // Форма та же, что у бота (`device_first_top_up_kopeks`), но ИСТОЧНИК минимума другой, и это
  // сознательно: бот читает сырой `.env` (`PLATEGA_MIN_AMOUNT_KOPEKS`), а мы — эффективный
  // минимум после админского сужения (`get_effective_amount_limits`), то есть ровно то число,
  // которым сервер отобьёт запрос. Поднимут минимум в админке — недоплатит бот, не кабинет.
  const roundUpToRubleKopeks = (kopeks: number) => Math.ceil(kopeks / 100) * 100;
  const topUpChargeKopeks =
    confirmShortageKopeks > 0
      ? Math.max(
          roundUpToRubleKopeks(confirmShortageKopeks),
          roundUpToRubleKopeks(topUpProviderMinKopeks ?? 0),
        )
      : 0;
  // Мостик словарей: касса зовёт способ `sbp`/`cards_ru`/`crypto`, экран пополнения знает тот
  // же способ по числу (`'2'`/`'11'`/`'13'`). Общее поле ровно одно — `provider_code`, и оно
  // буквально `option.id` того экрана (оба фильтруются одним `sub_options`).
  // ⚠️ ЧЕСТНО ПРО ГРАНИЦУ (переписано волной ревью — прежняя формулировка приписывала человеку
  // выбор, которого он на этом экране не делает). Способ берётся из состояния `methodKey`, а
  // кнопки способов его НЕ меняют: тап по ним создаёт ПРЯМОЙ счёт на полную цену и на
  // пополнение не идёт вовсе. Значит на пополнение уезжает УМОЛЧАНИЕ — первый способ, который
  // дал сервер (на боевом это СБП). Это не дефект: тот же способ подставил бы и сам экран
  // пополнения (`getPreferredOptionId`), а выбрать другой человек может там же, чипом. Ценность
  // параметра в другом: он ЯВНЫЙ и проверяемый, поэтому молчаливой подмены не будет.
  // ⚠️ И второе: `methodKey` живёт всю сессию компонента. Если человек переключил радиогруппу
  // на экране счёта прошлого заказа, а заказ умер и вернул его на подтверждение, сюда приедет
  // ЕГО прошлый выбор. Это его же выбор, а не чужой, но на экране он не подписан.
  const checkoutTopUpOptionId = methods.data?.methods.find(
    (method) => method.key === methodKey,
  )?.provider_code;
  // Автосоздание счёта включаем, только если ОБА числа известны: без минимума мы не знаем,
  // примет ли сервер сумму, без `provider_code` — не знаем, какой способ он подставит молча.
  const topUpAutoSubmit =
    topUpChargeKopeks > 0 && topUpProviderMinKopeks !== null && checkoutTopUpOptionId !== undefined;
  // Адрес возврата несёт СВОЮ метку `from=checkout`, а не опознаётся по маршруту: на
  // `/subscription/purchase` живут ещё три экрана (`TariffPurchaseForm`, `ClassicPurchaseWizard`,
  // `SwitchTariffSheet`), и они кладут в `returnTo` ровно эту же строку. Метку пишет только касса,
  // поэтому экран результата пополнения отличает её от них точным сравнением, а не префиксом.
  // `period`/`devices` едут тем же адресом. ⚠️ Точная формулировка: инертны не сами параметры —
  // их читает ещё и `fusedAutostart` — а КОНФИГУРАЦИЯ без `autostart=1` и `method`: без этих двух
  // диплинк-эффект выходит первой же строкой, и наша пара ничего не запускает. Мы их и не кладём.
  // 🔴 Этап Б-2: цель — сразу экран суммы нужного провайдера, а не выбор провайдера с одной
  // карточкой. ⛔ `getTopUpDestination` здесь НЕ используется намеренно: она отдаёт короткий
  // адрес, только пока доступен РОВНО ОДИН провайдер, — включат второго, и путь молча удлинится.
  // Если самого `platega` не окажется, `TopUpAmount` сам отбросит на выбор провайдера, сохранив
  // `amount` и `returnTo` и НЕ взяв с собой `option`/`auto` — то есть чужой способ не выстрелит.
  const checkoutTopUpHref = (() => {
    const target = new URLSearchParams({
      from: 'checkout',
      period: String(confirmPeriodDays),
      devices: String(confirmDeviceLimit),
    });
    const params = new URLSearchParams({ returnTo: `/subscription/purchase?${target}` });
    if (topUpChargeKopeks > 0) {
      params.set('amount', String(topUpChargeKopeks / 100));
    }
    if (topUpAutoSubmit) {
      params.set('option', String(checkoutTopUpOptionId));
      params.set('auto', '1');
    }
    return `/balance/top-up/${CHECKOUT_TOP_UP_METHOD_ID}?${params}`;
  })();

  const armMutation = useMutation({
    mutationFn: () => deviceFirstApi.arm(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: acceptCheckout,
    onError: setActionError,
  });
  const recoverAmbiguousCheckout = async (error: unknown) => {
    setActionError(error);
    if (deviceFirstErrorCode(error) === 'invoice_terminal') {
      // 🔴 ЗДЕСЬ БЫЛ ВТОРОЙ МОЛЧАЛИВЫЙ ВЫБРОС, и он пережил первую волну правок этапа.
      // Сервер бросает `invoice_terminal` ровно тогда же, когда закрывает счёт причиной
      // `provider_terminal:*` — то есть это ТОТ ЖЕ человек и то же состояние, ради которого
      // затеян этап. Прежний код звал `returnToConfiguration()`, а тот первой строкой делает
      // `setActionError(null)`: поставленная строкой выше ошибка стиралась в том же кадре, и
      // человек, нажавший «оплатить», молча оказывался на экране выбора срока. Объяснения он
      // не видел никогда.
      // Теперь вместо выброса перечитываем строку заказа: сервер вернёт её уже закрытой, и
      // человек прочитает то же, что читает пришедший опросом. Ошибку не стираем — если
      // перечитать не удалось, ему останется хотя бы она.
      // ⚠️ Здесь стоял ещё и `rememberSelection(checkout)` — он был нужен, пока эта ветка
      // ВЫБРАСЫВАЛА человека на экран выбора. Выброса больше нет, человек остаётся на строке
      // заказа, а уходит кнопкой «Начать новый расчёт», которая помнит выбор сама. Мутация
      // показала, что строка стала мёртвой: без неё не краснеет ни один сторож. Убрана —
      // мёртвый вызов на денежном экране врёт следующему читателю сильнее, чем его отсутствие.
      // ⚠️ Волна 2: на pay-time мутациях локальной строки НЕТ по построению, и перечитывать
      // тогда нечего — запрос разыменовал бы `null`. В этом случае человек остаётся на
      // подтверждении с поставленной выше ошибкой, у которой теперь есть свой честный текст
      // (`invoice_terminal` в карте сообщений ниже, слово в слово из бота).
      if (checkout) void statusQuery.refetch();
      return;
    }
    if (deviceFirstErrorCode(error) !== 'reconciliation_required') return;
    try {
      // Invoice creation may have committed before a timeout. The owned server
      // state is authoritative and exposes recovery controls without creating
      // another invoice. At pay time no local checkout exists yet, so the one
      // open order is the recovery target.
      acceptCheckout(
        checkout ? await deviceFirstApi.get(checkout.id) : await deviceFirstApi.getOpen(),
      );
    } catch {
      // Keep the original reconciliation error; support remains available.
    }
  };
  // Shared pay-time error mapping for the fused commit and the fused native
  // launch: every code lands on a deliberate screen, never a dead-end generic
  // failure.
  const dropResumedRowToLocalConfirmation = (row: DeviceFirstCheckout) => {
    // The resumed row is terminally gone server-side (killed by a reprice or
    // by a race sweep). Keep the person on the local confirmation of the SAME
    // selection, priced from the fresh matrix — never loop the row's stale
    // total, never strand them on an empty screen while ?checkout= still
    // points at the dead row.
    setPeriod(row.period_days);
    setDevices(row.selected_device_limit);
    setConfirmation(true);
    setCheckout(null);
    if (fixtureCheckout === undefined) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('checkout');
      setSearchParams(nextParams, { replace: true });
    }
  };
  const handlePayError = async (error: unknown) => {
    const code = deviceFirstErrorCode(error);
    if (code === 'reprice_required') {
      // No new row and no invoice cancellation: re-read the server prices and
      // redraw the confirmation. The next click sends the NEW price under a
      // NEW idempotency key (the price is part of the pay intent). A resumed
      // row is terminally killed by the reprice, so it must leave the screen
      // first — otherwise the CTA keeps offering its stale total forever.
      setRepriced(true);
      if (resumedConfirmation) {
        dropResumedRowToLocalConfirmation(resumedConfirmation);
      }
      await queryClient.invalidateQueries({ queryKey: ['device-first-options'] });
      return;
    }
    if (code === 'wallet_insufficient') {
      // No row was created: the person stays on the confirmation and gets a
      // top-up path; the refreshed options also refresh the shown balance.
      void queryClient.invalidateQueries({ queryKey: ['device-first-options'] });
      setActionError(error);
      return;
    }
    if (code === 'invalid_state') {
      // Cross-configuration race: this request's fresh row was already
      // cancelled by the concurrent winner's sweep. Land on the canonical
      // screen of the surviving order; if none survives, quietly keep the
      // local confirmation — the selection is intact and nothing was charged.
      try {
        setActionError(error);
        acceptCheckout(await deviceFirstApi.getOpen());
        return;
      } catch (recoveryError) {
        if (deviceFirstErrorCode(recoveryError) === 'no_open_checkout') {
          if (resumedConfirmation) {
            dropResumedRowToLocalConfirmation(resumedConfirmation);
          }
          setActionError(null);
          return;
        }
        setActionError(error);
        return;
      }
    }
    if (
      code === 'funding_mode_locked' ||
      code === 'open_checkout_exists' ||
      code === 'operator_review_required'
    ) {
      // A live server-owned order already fixes this purchase (possibly under
      // another funding mode). Land on its canonical screen — it exposes the
      // explicit abandon path — instead of a generic error.
      try {
        setActionError(error);
        acceptCheckout(await deviceFirstApi.getOpen());
        return;
      } catch (recoveryError) {
        // Only a canonical 404 from the server proves that the old order is
        // gone. A network failure must retain the original key so a retry
        // remains idempotent and can resume the same order later.
        if (deviceFirstErrorCode(recoveryError) === 'no_open_checkout') {
          deviceFirstApi.clearCreateIntents();
        }
        setActionError({
          response: { data: { detail: { code: 'open_checkout_recovery_failed' } } },
        });
        return;
      }
    }
    await recoverAmbiguousCheckout(error);
  };
  // 🔴 Пункт 4.11а. Кнопка оплаты на экране счёта рисуется из запроса `getPendingPayment`,
  // а тот отвечает один раз: одна сетевая осечка — и человек остаётся на экране БЕЗ
  // ЕДИНОГО способа заплатить. (⚠️ 26.08.2026, мина AN: прежде здесь было написано «живёт с
  // `retry: false`» — больше не живёт, молчание сети переспрашивается дважды. Довод ниже от
  // этого не изменился: ответ мутации всё равно свежее любого повтора.) Пока мы уходили редиректом, это было незаметно, адрес держали
  // в руках. Поэтому ответ мутации кладём в ТОТ ЖЕ кэш, откуда экран берёт кнопку: это такой
  // же ответ сервера, только свежее — адрес пришёл вместе с самим счётом.
  // 🔴 Кэш именно ЗАПИСЫВАЕМ, а не инвалидируем: `resume` не меняет id заказа, и в кэше
  // оставалось протухшее `resume_allowed: true`. Человек возвращался на кнопку «создать счёт»
  // и жал её повторно — петля. Запись убирает её без похода в сеть, поэтому петля не вернётся
  // даже если перезапрос упадёт.
  // ⚠️ Осознанно НЕ перекрываем этим адресом более поздний ответ сервера. Его `null` — не
  // «не успели», а вердикт `_is_live_direct_provider_invoice`: счёт оплачен, отменён или
  // протух. Перекрыв вердикт, мы бы вернули человека ровно в ту ловушку, которую чиним, —
  // увели бы на мёртвую страницу провайдера, откуда возврата нет.
  const rememberInvoiceRedirect = (result: DeviceFirstCommitResponse) => {
    // 🔴 Записываем БЕЗУСЛОВНО, даже когда адреса нет. Сервер сознательно опускает его, если
    // попытка «ambiguous/reconciling» (`app/cabinet/routes/device_first.py:812-819`), и раньше
    // на этом месте стоял ранний выход. Тогда в кэше оставалось протухшее
    // `resume_allowed: true`, кнопка «Продолжить создание счёта» никуда не девалась, а второй
    // тап по ней получал `invoice_resume_unavailable` — код, которого нет в разборе ошибок, то
    // есть безликое «попробуйте ещё раз» при живой кнопке. Ровно та петля, которую пункт чинит.
    // `resume_allowed: false` здесь — не догадка: сервер отдаёт `true` только когда попыток нет
    // вовсе, а после этой мутации попытка существует всегда.
    queryClient.setQueryData(['device-first-pending-payment', result.checkout.id], {
      redirect_url: result.redirect_url ?? null,
      // Значение сервера, а не выдуманное: адрес есть только у живой `pending`-попытки, его
      // отсутствие сервер комментирует как сверку.
      status: result.redirect_url ? 'pending' : 'reconciliation',
      resume_allowed: false,
    });
    // Новый счёт — новый отсчёт опроса. `pollStartedAt` сбрасывается только когда меняется
    // СТРОКА состояния заказа, а `resume` оставляет ту же `awaiting_payment` под тем же id:
    // без этой строки у возобновлённого счёта опрос не включался бы вовсе.
    pollStartedAt.current = Date.now();
  };
  const payMutation = useMutation({
    mutationFn: ({
      fundingMode,
      selectedMethodKey,
    }: {
      fundingMode: 'wallet' | 'platega';
      selectedMethodKey?: string;
    }) =>
      deviceFirstApi.payDirect({
        period_days: confirmPeriodDays,
        selected_device_limit: confirmDeviceLimit,
        funding_mode: fundingMode,
        method_key: fundingMode === 'platega' ? (selectedMethodKey ?? null) : null,
        // The exact amount the person confirmed, never rounded: the raw matrix
        // price for a fresh selection, the row's immutable total for a resume.
        expected_tariff_total_kopeks: confirmTotalKopeks!,
      }),
    onMutate: () => {
      setActionError(null);
      setRepriced(false);
    },
    onSuccess: (result) => {
      // 🔴 Пункт 4.11а: здесь СТОЯЛ автоматический уход к провайдеру. Он перепрыгивал наш
      // же экран счёта — тот рождался и в ту же секунду умирал вместе с документом, а
      // человек оказывался на странице Platega, откуда возврата нет. Уходим теперь только
      // по явному нажатию на экране счёта.
      rememberInvoiceRedirect(result);
      acceptCheckout(result.checkout);
    },
    onError: handlePayError,
  });
  const nativeLaunchMutation = useMutation({
    mutationFn: (launch: {
      periodDays: number;
      deviceLimit: number;
      method: string;
      expectedKopeks: number;
    }) =>
      deviceFirstApi.nativeLaunchDirect({
        period_days: launch.periodDays,
        selected_device_limit: launch.deviceLimit,
        funding_mode: 'platega',
        method_key: launch.method,
        expected_tariff_total_kopeks: launch.expectedKopeks,
      }),
    onMutate: () => {
      setActionError(null);
      setRepriced(false);
    },
    onSuccess: (result) => {
      // 🔴 Пункт 4.11а: и здесь стоял автоматический уход — шестым переходом, `replace`.
      // Эта мутация запускается автостартом по диплинку из бота, вообще без касания в
      // мини-аппе: человек уезжал к провайдеру, ни разу ничего тут не нажав.
      rememberInvoiceRedirect(result);
      acceptCheckout(result.checkout);
    },
    onError: handlePayError,
  });
  const paymentMutation = useMutation({
    mutationFn: () => deviceFirstApi.createPaymentAttempt(checkout!.id, methodKey),
    onMutate: () => {
      setActionError(null);
      setExistingPaymentAttempt(null);
    },
    onSuccess: (attempt) => {
      if (attempt.method_key !== methodKey) {
        setExistingPaymentAttempt(attempt);
        return;
      }
      openProviderLink(attempt.redirect_url);
    },
    onError: recoverAmbiguousCheckout,
  });
  const resumeInvoiceMutation = useMutation({
    mutationFn: () => deviceFirstApi.resumeInvoice(checkout!.id, methodKey),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      // 🔴 Пункт 4.11а, третий автоматический уход. Здесь же вторая ловушка — протухшее
      // `resume_allowed: true` в кэше; её закрывает запись свежего ответа, см. helper выше.
      rememberInvoiceRedirect(result);
      acceptCheckout(result.checkout);
    },
    onError: recoverAmbiguousCheckout,
  });
  const cancelMutation = useMutation({
    mutationFn: () => deviceFirstApi.cancel(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: (next) => {
      if (next.ui_state === 'cancelled') {
        rememberSelection(next);
        returnToConfiguration();
        return;
      }
      acceptCheckout(next);
    },
    onError: setActionError,
  });
  const abandonMutation = useMutation({
    mutationFn: () => deviceFirstApi.abandon(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: (next) => {
      if (next.ui_state === 'cancelled') {
        rememberSelection(next);
        returnToConfiguration();
        return;
      }
      acceptCheckout(next);
    },
    onError: recoverAmbiguousCheckout,
  });
  const legacyDraftCancelMutation = useMutation({
    mutationFn: (draft: DeviceFirstCheckout) => deviceFirstApi.cancel(draft.id),
    onMutate: () => setActionError(null),
    onSuccess: (_next, draft) => {
      // The stale showcase quote is cancelled; rebuild the same selection
      // locally. No payment attempt ever existed for it, so nothing else must
      // be reconciled.
      if (priceFor(draft.period_days, draft.selected_device_limit)) {
        setPeriod(draft.period_days);
        setDevices(draft.selected_device_limit);
      }
      returnToConfiguration();
    },
    onError: setActionError,
  });
  // 🔴 Мина AR. ЗДЕСЬ СТОЯЛ МОЛЧАЛИВЫЙ АВТО-ВОЗВРАТ и снят намеренно (этап AR, 25.08.2026).
  // Он ловил `ui_state === 'cancelled'` с причиной `provider_terminal:*` и сразу звал
  // `returnToConfiguration()` — человека, у которого платёжная система закрыла счёт, отматывало
  // на выбор срока БЕЗ ЕДИНОГО СЛОВА. На боевом это 22 из 31 отменённого заказа.
  // Теперь он остаётся на экране закрытого заказа и читает `closedCartCopy` (`:1084`), а уходит
  // сам — кнопкой «Начать новый расчёт», которая делает ровно то же самое (`startNewQuote`).
  // ⛔ Ничего, кроме показа, снятие не меняет: `statusQuery` и `pendingPayment` на `cancelled`
  // выключаются сами своими `enabled`, `clearCreateIntents` чистит префикс `create:`, которого
  // этот экран не заводит вовсе (запрещено сторожем `contract.test.ts`), а `cancelled` не входит
  // в `OPEN_STATES` сервера и новую покупку не запирает.
  const pendingPayment = useQuery({
    queryKey: ['device-first-pending-payment', checkout?.id],
    queryFn: () => deviceFirstApi.getPendingPayment(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      checkout?.settlement_mode === 'direct_purchase_v2' &&
      checkout.ui_state === 'awaiting_payment',
    // 🔴 Мина AN. Было `retry: false`, и ОДНА осечка сети выглядела как окончательный ответ
    // «платить нечем»: адрес оплаты берётся ТОЛЬКО из ответа этого запроса, и кнопка исчезала.
    // ⛔ Но переспрашивать можно ТОЛЬКО молчание сети. Если сервер ОТВЕТИЛ, что адреса нет
    // (4xx, `pending_payment_not_found`), это не осечка, а защита от повторной оплаты —
    // её нельзя ни переспрашивать, ни пережидать спиннером на денежном экране. Различаем
    // ровно тем же признаком, что и слой запросов (`api/deviceFirst.ts`, `postPayIntent`):
    // есть ответ сервера ниже 500 — окончательно, нет ответа или 5xx — можно переспросить.
    // Задержка короткая нарочно: пока идут повторы, человеку нечем платить.
    retry: (failureCount, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      return failureCount < 2 && (status === undefined || status >= 500);
    },
    retryDelay: 300,
  });
  // Пункт 4.11а: единственный источник кнопки оплаты — ответ сервера. Свежий адрес попадает
  // сюда записью в кэш из `rememberInvoiceRedirect`, а не отдельной веткой в обход сервера.
  const invoiceRedirectUrl = pendingPayment.data?.redirect_url ?? null;

  useEffect(() => {
    if (!fusedAutostart || checkout || legacyDraft || methods.isLoading) return;
    const periodDays = Number(autostartPeriodParam);
    const deviceLimit = Number(autostartDevicesParam);
    const launchKey = `${autostartPeriodParam}:${autostartDevicesParam}:${nativeLaunchMethod}`;
    if (nativeLaunchRef.current === launchKey) return;
    nativeLaunchRef.current = launchKey;

    const selection =
      Number.isInteger(periodDays) &&
      periodDays > 0 &&
      Number.isInteger(deviceLimit) &&
      deviceLimit > 0
        ? priceFor(periodDays, deviceLimit)
        : undefined;
    const method = nativeLaunchMethod;
    const availableMethods = methods.data?.methods.map((item) => item.key) ?? [];
    // The Telegram launch query is deliberately single-use: browser Back or a
    // reload can never submit another payment command automatically.
    consumeNativeLaunchParams();
    if (methods.isError) {
      setActionError({
        response: { data: { detail: { code: 'payment_methods_load_failed' } } },
      });
      return;
    }
    if (!selection) {
      setActionError({ response: { data: { detail: { code: 'invalid_selection' } } } });
      return;
    }
    if (!method || !availableMethods.includes(method)) {
      setActionError({
        response: { data: { detail: { code: 'payment_method_unavailable' } } },
      });
      return;
    }

    // 🔴 РЕК-8а. ЧЕТВЁРТАЯ ветка «не стрелять», по образцу трёх соседних выше.
    // Автозапуск выставлял счёт на ПОЛНУЮ цену, не показав денежный экран НИ НА КАДР: человек
    // со своими деньгами на счету их не видел и выбрать не мог. Родившийся так заказ немедленно
    // взводит `funding_mode`, а обратно в пустое тот не сбрасывается НИКОГДА — после этого
    // дверь доплаты гаснет на обоих экранах чата (`device_first.py:1010` и `:1127`, наша мина
    // FE), и по времени такой заказ не протухает (`device_first_checkout_service.py:890`).
    //
    // 🔴 ПРАВИЛО ТО ЖЕ, ЧТО У БОТА, и это не совпадение: бот прячет дверь доплаты ровно при
    // `not 0 < top_up < price` (`device_first.py:311`). Держим три случая и ровно три:
    //   · денег ХВАТАЕТ на всё — держим. Дойти сюда можно только со СТАРОГО сообщения в чате
    //     (при полном балансе бот карточных кнопок не рисует вовсе), а это ровно тот вход, где
    //     человек только что доплатил и вернулся: экран предложит «Списать и оформить», и
    //     второго платежа за ту же подписку не будет. Нашла линза корректности;
    //   · денег ЧАСТЬ и доплата КОРОЧЕ прямой оплаты — держим, ради этого этап;
    //   · денег ЧАСТЬ, но доплата равна полной цене (копейки на счету) — НЕ держим. Доплата
    //     тогда не короче, кнопка на экране уезжает вниз и тихнет, строка про арифметику
    //     молчит — человек получил бы лишний экран и ноль новой информации. Нашла линза UX.
    // ⚠️ Минимум провайдера сюда не приезжает (он отдельным запросом), поэтому сравниваем по
    // округлению до рубля — той половине правила, которая считается прямо здесь.
    const autostartBalanceKopeks = options.balance_kopeks ?? 0;
    const autostartShortageKopeks = Math.max(0, selection.price_kopeks - autostartBalanceKopeks);
    const autostartHold =
      autostartBalanceKopeks > 0 &&
      (autostartShortageKopeks === 0 ||
        Math.ceil(autostartShortageKopeks / 100) * 100 < selection.price_kopeks);

    // Validated: mirror the selection locally so a failure lands on an honest
    // confirmation screen, then fire the only automatic financial call. The
    // fused endpoint verifies the signed Telegram identity before any order
    // exists and reuses the same durable idempotency/one-invoice protections
    // as a manual pay click.
    setPeriod(periodDays);
    setDevices(deviceLimit);
    setConfirmation(true);
    if (autostartHold) {
      // 🔴 Молчаливая остановка — единственная из четырёх веток без единого слова человеку.
      // Он нажал «Карта · 450 ₽», ждал банк, а получил экран с другим числом на кнопке: без
      // объяснения это читается как «не сработало», и он жмёт карту второй раз. Три соседние
      // ветки ставят сообщение — ставим и мы, но не ошибкой: ничего не сломалось.
      setAutostartHeldForWallet(true);
      // 🔴 Способ оплаты человек УЖЕ назвал в чате, а `methodKey` жил умолчанием `'sbp'` и из
      // адреса не засевался никогда. До этой ветки он до экрана доплаты не доходил вовсе;
      // теперь доходит — и главная кнопка увела бы его в СБП, хотя он выбрал карту
      // (`checkoutTopUpOptionId` строится из `methodKey`). Засеваем ПРОВЕРЕННЫЙ способ: он
      // прошёл `availableMethods.includes(method)` строкой выше.
      setMethodKey(method);
      return;
    }
    nativeLaunchMutation.mutate({
      periodDays,
      deviceLimit,
      method,
      expectedKopeks: selection.price_kopeks,
    });
  }, [
    autostartDevicesParam,
    autostartPeriodParam,
    checkout,
    consumeNativeLaunchParams,
    fusedAutostart,
    legacyDraft,
    methods.data?.methods,
    methods.isError,
    methods.isLoading,
    nativeLaunchMethod,
    nativeLaunchMutation,
    options.balance_kopeks,
    priceFor,
  ]);

  useEffect(() => {
    if (checkout?.ui_state === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['device-first-options'] });
      // Покупка ГАСИТ одноразовую скидку (этап СК-1а в боте). Без этих двух ключей
      // баннер «Скидка N% активна» висит после оплаты, а тот же кэш кормит ценами
      // экраны покупки — человек видел бы цену со скидкой, которой у него больше нет.
      queryClient.invalidateQueries({ queryKey: ['active-discount'] });
      queryClient.invalidateQueries({ queryKey: ['promo-offers'] });
    }
  }, [checkout?.ui_state, queryClient]);
  useEffect(() => {
    if (
      checkoutUiState &&
      ['awaiting_payment', 'processing', 'provisioning'].includes(checkoutUiState)
    ) {
      pollStartedAt.current = Date.now();
    }
  }, [checkoutUiState]);
  useEffect(() => {
    if (modalOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Checkout content is portalled outside #root, so this makes the whole
      // application (including its global header and bottom navigation) inert
      // while an explicit checkout decision is on screen.
      const appRoot = document.getElementById('root');
      const wasInert = appRoot?.inert ?? false;
      if (appRoot) appRoot.inert = true;
      dialogRef.current?.focus();
      return () => {
        if (appRoot) appRoot.inert = wasInert;
        previousFocusRef.current?.focus();
      };
    }
    return undefined;
  }, [checkoutUiState, modalOpen]);

  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Checkout amounts are server-owned Russian kopeks. Do not apply the
  // display-currency converter here: it would show an estimate in another
  // currency while the payment and debit are still fixed in RUB. The UI
  // preserves non-zero kopeks, so it never conceals the exact amount the
  // server uses during confirmation and payment.
  const formatPrice = (kopeks: number) => {
    const sign = kopeks < 0 ? '-' : '';
    const absolute = Math.abs(kopeks);
    const rubles = Math.floor(absolute / 100).toLocaleString('ru-RU');
    const remainder = absolute % 100;
    return `${sign}${rubles}${remainder ? `,${String(remainder).padStart(2, '0')}` : ''} ₽`;
  };
  const pricePerDeviceMonth = (kopeks: number, deviceLimit: number, periodDays: number) => {
    // This is a compact comparison aid only. The full server-provided matrix
    // price above remains the amount used for confirmation and payment.
    const months = periodDays === 365 ? 12 : periodDays / 30;
    if (!Number.isFinite(months) || months <= 0 || deviceLimit <= 0) return null;

    return Math.round(kopeks / 100 / deviceLimit / months);
  };
  const periodLabel = (days: number) =>
    days === 365
      ? t('deviceFirst.periodYear')
      : days % 30 === 0
        ? t('deviceFirst.periodMonths', { count: days / 30 })
        : t('deviceFirst.periodDays', { count: days });
  const errorMessage = actionError ? deviceFirstErrorMessage(t, actionError) : null;
  const actionErrorCode = deviceFirstErrorCode(actionError);
  const choiceClass =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950';
  const requiresReconciliation = actionErrorCode === 'reconciliation_required';
  const requiresLegacyTrialReconciliation =
    actionErrorCode === 'legacy_trial_reconciliation_required';
  const legacyTrialSupportAction = requiresLegacyTrialReconciliation ? (
    <button
      type="button"
      onClick={() => navigate('/support')}
      className={`min-h-11 w-full rounded-xl border border-warning-400/40 px-4 py-2 text-sm font-semibold text-warning-200 hover:bg-warning-400/10 ${choiceClass}`}
    >
      {t('deviceFirst.contactSupport')}
    </button>
  ) : null;
  const isPending =
    payMutation.isPending ||
    nativeLaunchMutation.isPending ||
    armMutation.isPending ||
    paymentMutation.isPending ||
    resumeInvoiceMutation.isPending ||
    cancelMutation.isPending ||
    legacyDraftCancelMutation.isPending;
  const changeChoiceWithArrows = <Value extends string | number>(
    event: KeyboardEvent<HTMLButtonElement>,
    values: Value[],
    current: Value,
    change: (next: Value) => void,
  ) => {
    if (!values.length) return;
    const isRtl = document.documentElement.dir === 'rtl';
    const direction =
      event.key === 'ArrowDown' ||
      (event.key === 'ArrowRight' && !isRtl) ||
      (event.key === 'ArrowLeft' && isRtl)
        ? 1
        : event.key === 'ArrowUp' ||
            (event.key === 'ArrowLeft' && !isRtl) ||
            (event.key === 'ArrowRight' && isRtl)
          ? -1
          : 0;
    const home = event.key === 'Home';
    const end = event.key === 'End';
    if (!direction && !home && !end) return;
    event.preventDefault();
    const index = Math.max(0, values.indexOf(current));
    const nextIndex = home
      ? 0
      : end
        ? values.length - 1
        : (index + direction + values.length) % values.length;
    change(values[nextIndex]);
    const radios = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ??
        [],
    ).filter((radio) => !radio.disabled);
    radios?.[nextIndex]?.focus();
  };
  const startNewQuote = () => {
    rememberSelection(checkout);
    // A prior conflicting create can belong to a different selection than the
    // resumed checkout. This explicit "start over" action clears every local
    // create key, but never confirmation/payment idempotency keys.
    returnToConfiguration();
  };
  const refreshCheckout = () => {
    void statusQuery.refetch();
    void pendingPayment.refetch();
  };
  useEffect(() => {
    // 🔴 Пункт 1 реза 22.08.2026. Мини-приложение больше не умирает при уходе на оплату,
    // значит возврат из банка — это НЕ новая загрузка, и сам по себе экран не обновится:
    // `refetchOnWindowFocus` выключен глобально (`main.tsx:121-126`).
    // Перечитываем заказ и перевзводим отсчёт опроса, иначе человек возвращается на экран,
    // который замолчал ещё пока он был в банке (порог 2 минуты, `:365`).
    // Условие `paymentLinkOpenedRef` — то же, что на экране пополнения (`TopUpAmount.tsx:301`):
    // просто свернуть и развернуть мини-приложение не должно ничего перезапрашивать.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!paymentLinkOpenedRef.current) return;
      pollStartedAt.current = Date.now();
      refreshCheckout();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
  const paymentMethodLabel = (key: string) =>
    key === 'sbp'
      ? t('deviceFirst.sbp')
      : key === 'cards_ru'
        ? t('deviceFirst.cards')
        : key === 'crypto'
          ? t('deviceFirst.crypto')
          : t('deviceFirst.paymentMethodUnknown');
  const paymentMethodAmountLabel = (key: string, amount: string) =>
    t('deviceFirst.paymentMethodAmount', { method: paymentMethodLabel(key), amount });
  const invoiceDeadline = checkout?.provider_invoice_expires_at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(checkout.provider_invoice_expires_at),
      )
    : null;
  // Мина F: заказ приходит уже закрытым. На этом экране обязано остаться предупреждение про
  // старую ссылку Platega (она ещё принимает деньги), а если по ней всё-таки заплатили —
  // сказать, что деньги на балансе. `null` = обычный текст экрана.
  const closedCart = closedCartCopy(checkout?.terminal_reason, checkout?.money_state);
  // 🔴 Пункт 4.11а. Экран счёта показывают СВАЛКОЙ состояний, и описывать его одним из них
  // нельзя. Развилка ровно одна и честная: есть ли человеку чем платить.
  //   есть кнопка  → счёт живой, зовём оплатить, пока он действует;
  //   кнопки нет   → сервер не отдал адрес. Причин несколько и они неразличимы снаружи:
  //                  счёт ещё создаётся, уже отменён провайдером, протух —
  //                  🔴 или ЧЕЛОВЕК УЖЕ ЗАПЛАТИЛ, а вебхук не дошёл: забор
  //                  `_is_live_direct_provider_invoice` гасит адрес и по `payment.is_paid`
  //                  (`app/cabinet/routes/device_first.py:170`). Поэтому здесь берётся
  //                  штатный текст сверки: он единственный несёт защиту «не оплачивайте
  //                  повторно», а звать в этом состоянии к оплате — приглашать заплатить
  //                  второй раз. Текст не сочинён заново: он уже написан в проекте ровно
  //                  для этого состояния.
  // Условие пишется в ПОЛОЖИТЕЛЬНОЙ форме нарочно: строку `settlement_mode !== 'direct…'`
  // сторожит `DeviceFirstConfigurator.contract.test.ts:46`, прибивая ею совсем другую защиту
  // (`isShowcaseDraft`). Лишнее вхождение той же строки сделало бы того сторожа бесполезным.
  const isDirectInvoice = checkout?.settlement_mode === 'direct_purchase_v2';
  const canPayNow = Boolean(invoiceRedirectUrl);
  const directTitleKey = !isDirectInvoice
    ? 'deviceFirst.needTopup'
    : canPayNow
      ? 'deviceFirst.invoiceReadyTitle'
      : 'deviceFirst.paymentChecking';
  const directTextKey = !isDirectInvoice
    ? 'deviceFirst.armedNotice'
    : canPayNow
      ? 'deviceFirst.invoiceReadyText'
      : 'deviceFirst.paymentCheckingText';

  // 🔴 Этап Б-1: «человек имеет право потратить свой баланс в любой момент, а не когда будет
  // ошибка». Прежде эта кнопка стояла ВНУТРИ блока ошибки (`{errorMessage && …}`), а ошибки на
  // этом экране практически не бывает — то есть кнопку видел кто угодно, кроме того, кому она
  // нужна. 🔴 Дизъюнкт `wallet_insufficient` СОХРАНЁН намеренно: им держится редкая гонка
  // (баланс утёк между отрисовкой и тапом) и сторож «keeps the person on the confirmation with
  // a top-up path». Уберёшь — сторож покраснеет, и правильно сделает.
  // ⚠️ `fixtureCheckout` — витрина экранов: она рисует живой компонент на выдуманных опциях БЕЗ
  // баланса, поэтому недостача там равна полной цене. Кнопка обязана быть от неё закрыта: иначе
  // на странице, чей заголовок обещает «платежи не используются», появляется настоящая воронка.
  //
  // 🔴 Этап Б-2 сузил показ. Было «есть недостача» — и это накрывало КАЖДОГО новичка, у которого
  // недостача равна полной цене, а рядом уже стоит кнопка прямой оплаты, доводящая до подписки
  // сама и на одно нажатие короче. Стало три случая:
  //   · есть свои деньги и их не хватает — доплата действительно короче;
  //   · способы оплаты не поднялись — тогда пополнение единственный оставшийся выход,
  //     и его показываем ДАЖЕ при нулевом балансе (в общем пополнении бывают другие провайдеры);
  //   · `wallet_insufficient` — прежняя гонка.
  // Один признак на обе точки — заголовок и блок «Недоступно». Пока их было два разных
  // выражения, они разошлись: заголовок считал только `confirmTotalKopeks === null`.
  const selectionUnavailable = !confirmSelectionAvailable || confirmTotalKopeks === null;
  const paymentMethodsUnavailable =
    methods.isError || (!!methods.data && methods.data.methods.length === 0);
  // ⛔ ЗДЕСЬ СТОЯЛ ДИЗЪЮНКТ «а вдруг у общего пополнения есть провайдер, которого нет у кассы»
  // — и он ОТКАЧЕН критиком полноты как P0. Довод был живой (у новичка со звёздами на счету
  // касса не предлагает звёзд), но `is_available` сервер отдаёт литеральной правдой каждому
  // методу, поэтому признак вырождался в «есть ли в списке хоть что-то кроме platega» — и
  // возвращал кнопку «Пополнить 450 ₽» под три кнопки способов с тем же числом. Ровно те
  // «две кнопки с одинаковым числом, ведущие в 3 и в 6 касаний», из-за которых ревью
  // отклонило кандидата «А» и написало «без ветки нуля Б выпускать нельзя». Хуже: мои же
  // два сторожа стали утверждать противоположное про одного и того же человека.
  // Настоящая нужда («у новичка отняли дверь к другим способам оплаты») записана отдельным
  // пунктом плана — она про то, что касса умеет один провайдер, а не про эту кнопку.
  const balanceSideProviders = topUpMethods.data;
  // Последний выход — СПАСАТЕЛЬНЫЙ, поэтому умолчание у него «да». Ответа нет → выход
  // остаётся: отнять его из-за неотвеченного запроса значит оставить человека совсем без
  // действий. Гасим, только когда точно знаем, что на балансной стороне пусто, — иначе
  // кнопка ведёт в пустой экран, а тупик без объяснения хуже отсутствия кнопки.
  const anyTopUpProviderAvailable =
    balanceSideProviders === undefined ||
    balanceSideProviders.some((provider) => provider.is_available);
  const showTopUpAction =
    fixtureCheckout === undefined &&
    confirmSelectionAvailable &&
    confirmTotalKopeks !== null &&
    anyTopUpProviderAvailable &&
    ((confirmShortageKopeks > 0 && (hasWallet || paymentMethodsUnavailable)) ||
      actionErrorCode === 'wallet_insufficient');
  // Где она стоит. ПЕРВОЙ — только там, где доплата действительно короче прямой оплаты.
  // 🔴 Волна ревью: одного `hasWallet` мало. С копейками на балансе недостача округляется ДО
  // ПОЛНОЙ ЦЕНЫ — и громкой становилась дорога, которая на четыре экрана длиннее соседней
  // кнопки с тем же числом. Ровно то, за что ревью отклонило кандидата «А».
  // ⚠️ ЧЕСТНО ПРО ГРАНИЦУ (уточнил прогон сценария): условие отсекает ровно случай «платить
  // столько же, но дольше», и НЕ БОЛЬШЕ ТОГО. При рубле на балансе доплата 248 ₽ против цены
  // 249 ₽ всё ещё пойдёт первой. Порог «доплата должна быть заметно меньше цены» потребовал бы
  // выдуманного числа, а выдуманные пороги в этом проекте уже дорого стоили. Оставлено
  // проверяемое сравнение; остаток записан в план.
  const topUpActionGoesFirst =
    hasWallet &&
    !walletCoversTotal &&
    confirmTotalKopeks !== null &&
    topUpChargeKopeks > 0 &&
    topUpChargeKopeks < confirmTotalKopeks;

  // ⛔ Слова «и оформить» на этой кнопке НЕТ и быть не может: возврат приводит на подтверждение,
  // где надо нажать ещё раз. У device-first нет корзины (`user_cart_service` не встречается в нём
  // ни разу), поэтому доплата сама подписку не оформляет. Обещать оформление — врать.
  const topUpAction = showTopUpAction ? (
    <div className="space-y-1">
      {/* 🔴 Волна ревью: ТЗ требовало кнопку «первой, АКЦЕНТНОЙ», а она была рамочной — то есть
          в ветке частичного баланса на экране не оставалось ни одной залитой кнопки вовсе, хотя
          у соседней ветки («хватает») главное действие залито. Человек, уже проходивший кассу,
          ищет глазами заливку. Заливаем ровно там, где кнопка и есть главное действие; там, где
          она запасной выход, она обязана остаться тихой — иначе перетянет внимание у способов
          оплаты, которые короче. Отличие видно не только цветом: меняется вес фона. */}
      <button
        type="button"
        onClick={() => navigate(checkoutTopUpHref)}
        className={
          topUpActionGoesFirst
            ? `w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`
            : `w-full rounded-xl border border-accent-400/50 px-4 py-3 text-sm font-semibold text-accent-200 ${choiceClass}`
        }
      >
        {topUpChargeKopeks > 0
          ? t(hasWallet ? 'deviceFirst.topUpShortage' : 'deviceFirst.topUpAmount', {
              amount: formatPrice(topUpChargeKopeks),
            })
          : t('deviceFirst.needTopup')}
      </button>
      {/* 🔴 РЕК-8б. Связь ДЕНЕГ С ЦЕНОЙ на этом экране не была названа ни одной строкой: стояло
          слово «Баланс» — из банковского приложения, а не «ваши деньги в этой покупке». Человек
          должен был сам вспомнить, что у него есть N, и сам вычесть его из цены.
          ⛔ Слово «подарок»/«бонус» здесь НЕ писать: на балансе может лежать сдача, возврат или
          собственное пополнение, а происхождение денег этот экран не знает — фраза про подарок
          была бы прямой ложью на денежном экране. Строка говорит про АРИФМЕТИКУ, и она правда
          для всех.
          ⛔ И только когда кнопка несёт РОВНО недостачу. Если провайдерский минимум её поднял,
          на карточке уже стоит объяснение про остаток, и третье число превратило бы подсказку
          в ребус. */}
      {hasWallet &&
        topUpChargeKopeks > 0 &&
        topUpChargeKopeks === confirmShortageKopeks &&
        confirmBalanceKopeks !== null &&
        confirmTotalKopeks !== null && (
          <p className="text-xs text-dark-400">
            {t('deviceFirst.topUpBalanceApplied', {
              balance: formatPrice(confirmBalanceKopeks),
              total: formatPrice(confirmTotalKopeks),
            })}
          </p>
        )}
      {/* Подпись существует только там, где есть чем доплачивать и куда возвращаться.
          🔴 Волна ревью Б-2 переписала её текст: прежний («Доплатим … и вернёмся сюда списать …»)
          обещал автоматику, которой нет. Возврат делает человек, и после него он нажимает ещё
          раз — у device-first нет корзины, доплата подписку не оформляет.
          🔴 Этап В-1 переписал её ВТОРОЙ раз, и это единственная строка кассы, которую он
          тронул. Редакция Б-2 звала нажать кнопку «Списать с баланса» — подписи с таким текстом
          нет ни в одной из четырёх локалей, а после В-1 человек вдобавок возвращается не «сюда»,
          а на экран выбора. Новый текст не называет кнопок вовсе: обещает ровно то, что этап
          исполняет, — выбор сохранится, останется оформить заказ. */}
      {hasWallet && topUpChargeKopeks > 0 && (
        <p className="text-xs text-dark-400">{t('deviceFirst.topUpShortageHint')}</p>
      )}
      {/* 🔴 Волна ревью: сводка печатает честную недостачу, а кнопка — сумму счёта, и это
          РАЗНЫЕ числа, когда минимум провайдера больше недостачи. Два числа на одной карточке
          без объяснения человек читает как ошибку. Ключ не сочинён — он уже есть в проекте и
          говорит ровно про этот остаток на экране счёта. */}
      {topUpChargeKopeks > confirmShortageKopeks && confirmShortageKopeks > 0 && (
        <p className="text-xs text-dark-400">
          {t('deviceFirst.topUpSurplusHint', {
            amount: formatPrice(topUpChargeKopeks - confirmShortageKopeks),
          })}
        </p>
      )}
    </div>
  ) : null;

  return (
    <section
      data-testid="device-first-configurator"
      aria-busy={isPending}
      className="relative rounded-3xl p-4 pb-28 min-[360px]:p-5 min-[360px]:pb-28 sm:p-7 sm:pb-7"
      style={{ background: g.cardBg, border: `1px solid ${g.cardBorder}`, boxShadow: g.shadow }}
    >
      <div className="mb-6" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
        <h2 className="text-xl font-bold text-dark-50">{options.tariff?.name}</h2>
        {options.tariff?.description ? (
          <p className="mt-2 whitespace-pre-line text-sm text-dark-400">
            {options.tariff.description}
          </p>
        ) : (
          <p className="mt-2 text-sm text-dark-400">{t('deviceFirst.description')}</p>
        )}
      </div>

      {/* 🔴 Мина AR, вторая половина. Здесь стояло «Настраиваем VPN. Оплата учтена» — то есть
          экран утверждал ПОЛУЧЕНИЕ ДЕНЕГ в тот самый момент, когда он ещё только грузит строку
          заказа и не знает про них ничего. Это ровно ошибка пункта 4.2б, и она врала не только
          отказавшему: сюда же приводят карточка «незавершённый заказ» с Главной и кнопка из
          бота. Теперь текст говорит то, что происходит на самом деле, и не обещает ничего.
          ⛔ Соседний экран `processing`/`provisioning` ниже НЕ тронут: там сервер уже подтвердил
          оплату, и «Оплата учтена» — правда. */}
      {!checkout && initialCheckoutId && restoredCheckout.isLoading && (
        <StateMessage
          title={t('deviceFirst.restoringOrderTitle')}
          text={t('deviceFirst.restoringOrderText')}
        />
      )}
      {/* 🔴 Мина AR, найдено волной 1 (три линзы независимо). Здесь стоял тот же `refreshText`
          — «Данные подписки или цена изменились. Создайте новый расчёт — деньги без
          подтверждения не списаны». Обе половины неправда, и вторая опаснее: сюда падает
          ровно тот, у кого холодный старт вебвью сорвал ТРИ чтения подряд после оплаты
          картой (`retry: 2` заводили под эту когорту). Ему сообщали, что списания не было,
          и звали оформить заказ заново — то есть заплатить второй раз.
          Новый текст не утверждает про деньги ничего и несёт защиту вместо обещания. */}
      {!checkout && initialCheckoutId && restoredCheckout.isError && (
        <div className="space-y-4">
          <StateMessage
            title={t('deviceFirst.restoringErrorTitle')}
            text={t('deviceFirst.restoringErrorText')}
          />
          {/* ⚠️ Волна 2: текст просит «не создавайте новый заказ — напишите в поддержку», а
              единственная кнопка под ним называлась «Начать новый расчёт» и стирала `?checkout=`
              — последнюю ссылку на заказ, за который человек, возможно, заплатил. Соседние
              терминальные ветки выход в поддержку дают; эта не давала. Даём. */}
          <button
            type="button"
            onClick={() => navigate('/support')}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
          >
            {t('deviceFirst.contactSupport')}
          </button>
          <button
            type="button"
            onClick={startNewQuote}
            className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
          >
            {t('deviceFirst.startNew')}
          </button>
        </div>
      )}
      {legacyDraft && !checkout && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.refreshTitle')} text={t('deviceFirst.refreshText')} />
          <button
            type="button"
            disabled={legacyDraftCancelMutation.isPending}
            onClick={() => legacyDraftCancelMutation.mutate(legacyDraft)}
            className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.startNew')}
          </button>
          {errorMessage && (
            <div role="alert" className="space-y-2 text-sm text-error-400">
              <p>{errorMessage}</p>
              {legacyTrialSupportAction}
            </div>
          )}
        </div>
      )}
      {!checkout && !legacyDraft && !confirmation && !initialCheckoutId && (
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.periodQuestion')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('deviceFirst.periodQuestion')}
              className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
              {options.period_options?.map((value) =>
                (() => {
                  const optionPrice = priceFor(value, devices);
                  const isSelected = period === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      disabled={!optionPrice || isPending}
                      onKeyDown={(event) =>
                        changeChoiceWithArrows(
                          event,
                          (options.period_options ?? []).filter((candidate) =>
                            Boolean(priceFor(candidate, devices)),
                          ),
                          period,
                          setPeriod,
                        )
                      }
                      onClick={() => setPeriod(value)}
                      className={`flex min-h-16 items-center justify-center rounded-2xl border-2 px-3 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-45 ${choiceClass} ${
                        isSelected
                          ? 'border-accent-400 bg-accent-500/15 text-accent-200 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]'
                          : 'border-dark-700 bg-dark-800/45 text-dark-300'
                      }`}
                    >
                      <span className="text-sm font-semibold">
                        {optionPrice
                          ? periodLabel(value)
                          : `${periodLabel(value)} · ${t('deviceFirst.unavailable')}`}
                      </span>
                      {isSelected && <span className="sr-only">{t('deviceFirst.selected')}</span>}
                    </button>
                  );
                })(),
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.devicesQuestion')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('deviceFirst.devicesQuestion')}
              className="grid max-w-3xl grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            >
              {options.device_options?.map((value) =>
                (() => {
                  const optionPrice = priceFor(period, value);
                  const deviceMonthlyRate = optionPrice
                    ? pricePerDeviceMonth(optionPrice.price_kopeks, value, period)
                    : null;
                  const isSelected = devices === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      disabled={!optionPrice || isPending}
                      onKeyDown={(event) =>
                        changeChoiceWithArrows(
                          event,
                          (options.device_options ?? []).filter((candidate) =>
                            Boolean(priceFor(period, candidate)),
                          ),
                          devices,
                          setDevices,
                        )
                      }
                      onClick={() => setDevices(value)}
                      className={`flex min-h-28 flex-col items-center justify-center rounded-2xl border-2 px-2 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-45 ${choiceClass} ${
                        isSelected
                          ? 'border-accent-400 bg-accent-500/15 text-accent-200 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]'
                          : 'border-dark-700 bg-dark-800/45 text-dark-300'
                      }`}
                    >
                      <span className="text-base font-semibold leading-tight">
                        {t('deviceFirst.deviceCount', { count: value })}
                      </span>
                      <span className="mt-2 text-lg font-bold tabular-nums text-dark-100">
                        {optionPrice
                          ? formatPrice(optionPrice.price_kopeks)
                          : t('deviceFirst.unavailable')}
                      </span>
                      {deviceMonthlyRate !== null && (
                        <span className="mt-1 text-xs leading-4 text-dark-400">
                          {t('deviceFirst.perDeviceMonth', { amount: deviceMonthlyRate })}
                        </span>
                      )}
                      {isSelected && <span className="sr-only">{t('deviceFirst.selected')}</span>}
                    </button>
                  );
                })(),
              )}
            </div>
          </fieldset>
          <div className="rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs text-dark-500">{t('deviceFirst.total')}</div>
                <div className="mt-1 text-2xl font-bold text-dark-50">
                  {price ? formatPrice(price.price_kopeks) : '—'}
                </div>
              </div>
              <div className="text-right text-xs text-dark-400">
                {t('deviceFirst.deviceShort', { count: devices })} · {periodLabel(period)}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={!price || isPending}
            onClick={() => {
              // The confirmation step is local: no durable order is created
              // before a payment button is pressed.
              setActionError(null);
              setRepriced(false);
              setConfirmation(true);
            }}
            className={`mt-2 w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.review')}
          </button>
          <p className="-mt-3 text-center text-xs text-dark-500">{t('deviceFirst.reviewHint')}</p>
        </div>
      )}

      {(confirmation || resumedConfirmation) && !legacyDraft && (
        <div className="space-y-4">
          {payMutation.isPending || nativeLaunchMutation.isPending ? (
            <StateMessage
              title={t('deviceFirst.openingPayment')}
              text={t('deviceFirst.openingPaymentText')}
            />
          ) : (
            <>
              {/* 🔴 РЕК-8а. Объяснение остановки. НЕ ошибка и не предупреждение: ничего не
                  сломалось, поэтому спокойный акцентный блок, а не жёлтый. Стоит первым — до
                  сводки, потому что отвечает на вопрос «почему я здесь, а не в банке». */}
              {autostartHeldForWallet && (
                <div
                  role="status"
                  className="space-y-1 rounded-xl border border-accent-400/40 bg-accent-500/10 p-4"
                >
                  <p className="text-sm font-semibold text-dark-100">
                    {t('deviceFirst.autostartHeldTitle')}
                  </p>
                  <p className="text-sm text-dark-300">{t('deviceFirst.autostartHeldText')}</p>
                </div>
              )}
              {repriced && (
                <div
                  role="status"
                  className="space-y-1 rounded-xl border border-warning-500/40 bg-warning-500/10 p-4"
                >
                  <p className="text-sm font-semibold text-dark-100">
                    {t('deviceFirst.refreshTitle')}
                  </p>
                  <p className="text-sm text-dark-300">{t('deviceFirst.refreshText')}</p>
                </div>
              )}
              <SelectionSummary
                periodDays={confirmPeriodDays}
                deviceLimit={confirmDeviceLimit}
                priceKopeks={confirmTotalKopeks}
                // 🔴 Этап Б-2: обе строки — «Баланс» и «Не хватает» — гаснут ОДНИМ признаком,
                // потому что рисуются одним условием `balanceKopeks !== null`. Развести их
                // на два условия значит завести случай «не хватает без баланса».
                balanceKopeks={hasWallet ? confirmBalanceKopeks : null}
                currentDeviceLimit={
                  resumedConfirmation
                    ? resumedConfirmation.current_subscription_is_trial === false
                      ? resumedConfirmation.current_device_limit
                      : null
                    : options.current_subscription && !options.current_subscription.is_trial
                      ? options.current_subscription.device_limit
                      : null
                }
                formatPrice={formatPrice}
              />
              {/* 🔴 Этап Б-2. Одна строка на три развилки врала двум из трёх: у кого баланса
                  нет — «проверьте итог» нечего проверять, кроме цены; у кого он всё покрывает —
                  выбирать способ не из чего, кнопка одна.
                  🔴 Волна ревью нашла ДВЕ ветки, где строка врала и после первой правки, и
                  обе теперь молчат вместо обещания:
                  · выбор непригоден (`selectionUnavailable`) — ниже стоит «Недоступно», и мой
                    прежний комментарий был неверен: условие «Недоступно» ШИРЕ, чем
                    `confirmTotalKopeks === null`, у возобновлённого заказа цена остаётся
                    числом, а пары уже нет в матрице. Тогда экран обещал «проверьте итог перед
                    списанием» над словом «Недоступно» и без единой кнопки;
                  · способы оплаты не поднялись — обещать «выберите способ оплаты» над
                    «Не удалось загрузить способы оплаты» значит спорить с самим собой.
                  Молчание честнее: обе ветки ниже говорят про себя сами. */}
              {!selectionUnavailable &&
                !(paymentMethodsUnavailable && !walletCoversTotal) &&
                (walletCoversTotal || !hasWallet) && (
                  <p className="text-xs text-dark-400">
                    {t(
                      walletCoversTotal
                        ? 'deviceFirst.reviewBeforeCharge'
                        : 'deviceFirst.chooseMethodNotice',
                    )}
                  </p>
                )}
              {selectionUnavailable ? (
                <p role="status" className="text-sm text-warning-400">
                  {t('deviceFirst.unavailable')}
                </p>
              ) : (confirmBalanceKopeks ?? 0) >= confirmTotalKopeks ? (
                <button
                  type="button"
                  disabled={payMutation.isPending}
                  onClick={() => payMutation.mutate({ fundingMode: 'wallet' })}
                  className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                >
                  {t('deviceFirst.payAndOrder', { amount: formatPrice(confirmTotalKopeks) })}
                </button>
              ) : (
                <>
                  {/* 🔴 Этап Б-2, ветка частичного баланса: доплата — ПЕРВОЕ и акцентное
                      действие, способы оплаты остаются настоящими кнопками под ней. Порядок
                      важен физически: на телефоне до нижних кнопок надо доскроллить. */}
                  {topUpActionGoesFirst && topUpAction}
                  {methods.isLoading ? (
                    <p role="status" className="text-sm text-dark-400">
                      {t('deviceFirst.paymentMethodsLoading')}
                    </p>
                  ) : methods.isError ? (
                    <div className="space-y-2">
                      <p role="alert" className="text-sm text-error-400">
                        {t('deviceFirst.errorPaymentMethodsLoad')}
                      </p>
                      <button
                        type="button"
                        onClick={() => void methods.refetch()}
                        className={`w-full rounded-xl border border-dark-600 px-4 py-3 text-sm font-semibold text-dark-100 ${choiceClass}`}
                      >
                        {t('deviceFirst.retry')}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/support')}
                        className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                      >
                        {t('deviceFirst.contactSupport')}
                      </button>
                    </div>
                  ) : methods.data?.methods.length ? (
                    <>
                      {/* 🔴 Этап Б-2. «ИЛИ оплатите полной суммой» — это союз при двух вариантах.
                      У человека с нулём на балансе второго варианта не существует: доплачивать
                      нечего к нулю, и строка обещала выбор, которого нет. Показываем её только
                      тому, у кого рядом действительно стоит кнопка доплаты. */}
                      {hasWallet && (
                        <p className="text-sm text-dark-300">
                          {t('deviceFirst.paymentMethodsAvailable')}
                        </p>
                      )}
                      {/* 🔴 Пункт 4.11а: здесь стояло предупреждение «страница оплаты откроется
                          вместо кабинета» (мина W). Оно было правдой, пока тап по способу уводил
                          к провайдеру. Теперь тап создаёт счёт и показывает НАШ экран счёта —
                          старый текст стал бы ложью. Вместо него честное ожидание.
                          ⛔ Этап Б-2: строку пробовали опустить ПОД кнопки (так её просило ТЗ) —
                          и это откачено. Сторож «warns before leaving only on the screen that
                          still leads to the provider» требует её ВЫШЕ кнопок по делу: на телефоне
                          375×667 под ними она уходит за сгиб, а скринридер читает её уже ПОСЛЕ
                          нажатия. Предупреждение после действия предупреждением не является. */}
                      <p className="text-xs text-dark-400">{t('deviceFirst.twoStepPayHint')}</p>
                      <div className="grid gap-2">
                        {methods.data.methods.map((method) => (
                          <button
                            key={method.key}
                            type="button"
                            disabled={payMutation.isPending}
                            onClick={() =>
                              payMutation.mutate({
                                fundingMode: 'platega',
                                selectedMethodKey: method.key,
                              })
                            }
                            className={`min-h-12 rounded-xl border border-dark-700 px-4 py-3 text-left text-sm font-semibold text-dark-100 transition hover:border-accent-400 hover:bg-accent-500/10 disabled:opacity-50 ${choiceClass}`}
                          >
                            {paymentMethodAmountLabel(method.key, formatPrice(confirmTotalKopeks))}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p role="status" className="text-sm text-warning-400">
                        {t('deviceFirst.noMethods')}
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/support')}
                        className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                      >
                        {t('deviceFirst.contactSupport')}
                      </button>
                    </div>
                  )}
                </>
              )}
              {/* 🔴 Этап Б-2: здесь кнопка стоит ПОСЛЕДНЕЙ — там, где она не короткий путь, а
                  запасной выход: способы оплаты не поднялись, либо баланс утёк между отрисовкой
                  и тапом (`wallet_insufficient`, у такого человека денег на вид ХВАТАЕТ, и
                  наверху его ветки стоит «Списать … и оформить»). Обе точки разведены одним
                  признаком `topUpActionGoesFirst`, поэтому кнопка на экране всегда ровно одна. */}
              {!topUpActionGoesFirst && topUpAction}
              <button
                type="button"
                onClick={() => {
                  if (resumedConfirmation) {
                    // A resumed live order stays resumable; only its display
                    // is left behind, exactly like leaving an invoice screen.
                    // 🔴 Пункт 4.11а: через `startNewQuote`, а не голым возвратом — иначе
                    // выбор, лежащий в строке заказа, теряется ровно так же, как на экране
                    // счёта. Заказ этой ветки и есть `checkout`, который он запоминает.
                    startNewQuote();
                    return;
                  }
                  // No order exists yet: going back is pure local navigation.
                  setConfirmation(false);
                  setRepriced(false);
                  setActionError(null);
                }}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 ${choiceClass}`}
              >
                {t('deviceFirst.changeOptions')}
              </button>
            </>
          )}
          {errorMessage && (
            <div role="alert" className="space-y-2 text-sm text-error-400">
              <p>{errorMessage}</p>
              {/* 🔴 Этап Б-1: кнопка пополнения отсюда УБРАНА и переехала к способам оплаты
                  (выше по файлу). Здесь она была заперта двумя замками разом: внешним
                  `errorMessage &&` и `actionErrorCode === 'wallet_insufficient'` — то есть
                  показывалась только тому, у кого денег ХВАТАЛО в момент отрисовки. Оставить её
                  тут вторым экземпляром нельзя: после отказа опции инвалидируются (`handlePayError`),
                  баланс обновляется, и оба условия становятся истинными одновременно —
                  человек увидел бы две одинаковые кнопки. */}
              {legacyTrialSupportAction}
            </div>
          )}
        </div>
      )}

      {checkout?.ui_state === 'awaiting_payment' && (
        <CheckoutSurface
          // 🔴 Пункт 4.11а: имя окна берёт тот же ключ, что и заголовок — расхождение имени и
          // видимой надписи невозможно by construction. Прямой счёт объявлялся скринридеру
          // как «Нужно пополнить баланс», то есть чужим именем чужого экрана.
          label={t(directTitleKey)}
          portal={fixtureCheckout === undefined}
          dialogRef={dialogRef}
          onKeyDown={trapDialogFocus}
        >
          <h3 className="text-lg font-bold text-dark-50">{t(directTitleKey)}</h3>
          <Summary checkout={checkout} formatPrice={formatPrice} />
          <p className="text-sm text-dark-400">{t(directTextKey)}</p>
          {/* 🔴 Мина AQ. Сообщение живёт ТОЛЬКО пока заказ не закрыт: как только он станет
              `cancelled`, слово берёт объяснение закрытого счёта, и два голоса про одно
              состояние были бы ровно тем, что запрещает пункт 4.2б.
              ⚠️ Забор для этого стоит СНАРУЖИ — весь этот блок висит на
              `checkout?.ui_state === 'awaiting_payment'`. Здесь стояла его копия; мутация
              показала, что она ничего не держит, и копия убрана: условие, которое выглядит
              защитой, но не защищает, хуже отсутствия условия. */}
          {/* 🔴 ПУНКТ 2б: БАННЕР ОТКАЗА НЕ ИМЕЕТ ПРАВА ПЕРЕКРИКИВАТЬ СЕРВЕР.
              `paymentDeclined` приходит ИЗ АДРЕСА — это слово платёжной системы, сказанное
              редиректом, а не наш проверенный факт. Пункт 2б впервые довёл эту метку до
              авторизованного экрана (раньше отказавший упирался в форму входа), и вместе с
              ней приехал риск: провайдер уводит на `failedUrl`, пока платёж ещё жив, а деньги
              потом подтверждаются. Это не догадка — ровно это записано у соседа по проекту,
              `pages/TopUpResult.tsx:479-489`, и он поэтому даёт слову сервера перевес.
              ⛔ ФОРМУЛИРОВКА ИСПРАВЛЕНА ВОЛНОЙ 2: здесь стояло «`!canPayNow` = попытка ушла
              в сверку ЛИБО платёж уже помечен оплаченным». Это называло две причины из
              восьми и описывало не тот механизм, которым забор работает. Разбор по коду
              (`bot-code/app/cabinet/routes/device_first.py:161-185`):
              • `attempt.status != 'pending'` — ЕДИНСТВЕННОЕ живое плечо. Это окно сверки:
                терминальный колбёк провайдера уже пришёл, канонический опрос ещё не прошёл,
                и деньги в этом окне ВСЁ ЕЩЁ МОГУТ подтвердиться (ветка
                `late_paid_wallet_credit`). Объявлять здесь отказ — врать про деньги;
              • `payment.is_paid` — плечо НЕДОСТИЖИМО в этом блоке: признак оплаты и переход
                заказа в `fulfilling` ставятся ОДНОЙ транзакцией
                (`device_first_payment_service.py:2290-2303`), а `fulfilling` даёт `ui_state`
                `processing` — весь блок к этому моменту размонтирован;
              • остальные плечи («счёт протух», состояния заказа) означают «счёт мёртв», то
                есть СОГЛАШАЮТСЯ с отказом, а не спорят.
              🔴 ЗНАЧИТ У ЗАБОРА ЕСТЬ ЦЕНА, И ОНА ПРИНЯТА СОЗНАТЕЛЬНО: при протухшем счёте
              баннер молчит, и человек читает нейтральное «Проверяем счёт». Менять забор на
              «молчать только в сверке» ПРОБОВАЛИ и отвергли: тогда при протухшем счёте
              баннер встаёт рядом с «Не оплачивайте повторно» — то есть возвращается ровно
              та коллизия, ради которой забор и ставился (скептик волны 2 воспроизвёл её
              экспериментом, сняв это условие). Нейтральный текст в бакете «кнопки нет» — не
              новая уступка, а действующая философия этого экрана, см. `:1158-1166`
              (пункт 4.11а): снаружи «уже оплачено» неотличимо от прочих причин, и звать
              платить второй раз хуже, чем сказать общее.
              Этим же закрыт второй дефект: без забора экран одновременно писал сверху
              «Проверяем счёт… не оплачивайте повторно» (`paymentChecking`) и снизу «Оплата
              не прошла». Два голоса про одни деньги на одном экране — тот самый класс, что
              запрещён правилом 4.2б.
              ⚠️ Оставшееся окно названо честно и НЕ закрывается здесь: пока ни мы, ни
              провайдер ещё не знают исхода, баннер показывается — как и у соседа, намеренно.
              ⛔ И ЗДЕСЬ ТОЖЕ ИСПРАВЛЕНА ФОРМУЛИРОВКА (скептик волны 2): «текст ссылается на
              провайдера» — это довод о ЧЕСТНОСТИ, а не о сохранности денег, и выдавать его
              за доказательство безопасности нельзя. Про деньги в этом окне верно другое, и
              оно проверено по коду: вторую попытку наш код не заводит НИКОГДА
              (`get_pending_platega_attempt` + частичный уникальный индекс), кнопка ведёт на
              ТОТ ЖЕ счёт провайдера, повторное подтверждение идемпотентно
              (`_settle_direct_platega_payment_locked`), а поздний противоречащий сигнал
              уходит оператору на разбор, а не в автоматику. Двойное списание возможно только
              на стороне провайдера и только если человек сам оформит ДРУГУЮ конфигурацию —
              тогда первая сумма вернётся ему на баланс. Второго производителя этой метки
              (спящий `_checkout_return_url`) забор съел бы молча: у него нет
              `direct_purchase_v2`, значит `canPayNow` структурно `false`. Проснётся — чинить
              здесь. */}
          {paymentDeclined && canPayNow && (
            <div role="status" className="rounded-xl bg-error-500/10 p-3">
              <p className="text-sm font-semibold text-error-400">
                {t('deviceFirst.providerDeclinedNoticeTitle')}
              </p>
              {/* ⚠️ Второе предложение («счёт ещё открыт — можно попробовать») отсюда убрано
                  волной 2: адрес оплаты гаснет РАНЬШЕ, чем закрывается заказ, и текст звал
                  повторить там, где повторять нечем, а соседний абзац в это же время просит
                  «не оплачивайте повторно». Оставлено ровно то, что нам сказал провайдер. */}
              <p className="mt-1 text-sm text-dark-300">
                {t('deviceFirst.providerDeclinedNotice')}
              </p>
            </div>
          )}
          {checkout.settlement_mode === 'direct_purchase_v2' &&
            invoiceRedirectUrl &&
            invoiceDeadline && (
              <p className="text-sm text-dark-300">
                {t('deviceFirst.invoiceValidUntil', { date: invoiceDeadline })}
              </p>
            )}
          {checkout.settlement_mode !== 'direct_purchase_v2' &&
            (checkout.top_up_surplus_kopeks ?? 0) > 0 && (
              <p role="status" className="text-sm text-dark-300">
                {t('deviceFirst.topUpSurplusHint', {
                  amount: formatPrice(checkout.top_up_surplus_kopeks ?? 0),
                })}
              </p>
            )}
          {checkout.settlement_mode === 'direct_purchase_v2' ? (
            <>
              {invoiceRedirectUrl && (
                // Мина W: сюда человек приходит по карточке «Незавершённый заказ» с Главной,
                // то есть уже потеряв контекст один раз. Кнопка ниже уводит на провайдера тем
                // же путём, что и первая оплата, — предупреждение обязано быть и здесь.
                // 🔴 Пункт 4.11а: условие сузилось до кнопки оплаты. Раньше оно захватывало и
                // «Продолжить создание счёта», а та после этой же правки никуда не уводит —
                // предупреждение над ней стало бы такой же ложью, какую мы сняли с экрана
                // подтверждения.
                <p className="text-xs text-dark-400">{t('deviceFirst.leavingForProvider')}</p>
              )}
              {invoiceRedirectUrl && (
                <button
                  type="button"
                  onClick={() => {
                    const redirectUrl = invoiceRedirectUrl;
                    if (redirectUrl) openProviderLink(redirectUrl);
                  }}
                  className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
                >
                  {t('deviceFirst.continueExistingInvoice')}
                </button>
              )}
              {invoiceRedirectUrl && (
                // 🔴 Запасной выход. `openLink` отказывает молча: и SDK, и его запасной ход
                // могут не открыть ничего, не сказав об этом ни слова. Пока уход убивал
                // документ, отказ был виден сразу — экран просто не менялся. Теперь экран
                // остаётся прежним и при успехе, и при отказе, поэтому у человека обязан
                // быть способ забрать ссылку руками. Тот же приём на экране пополнения
                // (`TopUpAmount.tsx:406-415`).
                <button
                  type="button"
                  onClick={() => {
                    // Гасим прошлый таймер: иначе он догорит и сотрёт новый ответ.
                    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
                    // Возврат в `idle` перед ответом даёт видимый отклик и на ПОВТОРНОЕ
                    // нажатие поверх висящего отказа — иначе React не перерисует то же значение.
                    setCopyState('idle');
                    void copyToClipboard(invoiceRedirectUrl).then(
                      () => {
                        // Ссылка у человека в руках — значит платить он уйдёт наружу
                        // ровно так же, как по кнопке. Возврат обязан перечитать заказ.
                        markLeavingToPay();
                        setCopyState('copied');
                        copyResetTimerRef.current = setTimeout(() => setCopyState('idle'), 2000);
                      },
                      // Буфер недоступен: небезопасный контекст или несфокусированный
                      // вебвью (`utils/clipboard.ts`). Отказ обязан быть ВИДЕН, иначе
                      // запасной выход сам становится тупиком. В `idle` не возвращаем:
                      // подпись остаётся, пока человек не нажмёт ещё раз.
                      () => setCopyState('failed'),
                    );
                  }}
                  className={`min-h-11 w-full rounded-xl border border-dark-600 px-4 py-2 text-sm text-dark-200 ${choiceClass}`}
                >
                  {copyState === 'copied'
                    ? t('deviceFirst.paymentLinkCopied')
                    : copyState === 'failed'
                      ? t('deviceFirst.paymentLinkCopyFailed')
                      : t('deviceFirst.copyPaymentLink')}
                </button>
              )}
              {pendingPayment.data?.resume_allowed && (
                <button
                  type="button"
                  disabled={resumeInvoiceMutation.isPending || !methodKey}
                  onClick={() => resumeInvoiceMutation.mutate()}
                  className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                >
                  {t('deviceFirst.resumeInvoice')}
                </button>
              )}
              <button
                type="button"
                onClick={refreshCheckout}
                className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
              >
                {t('deviceFirst.refreshStatus')}
              </button>
              {/* 🔴 Пункт 4.11а: опрос перестал быть вечным, значит экран однажды замолкает.
                  Молчащий экран без объяснения — это «оплатил, а тут ничего не меняется».
                  Строка правдива в любой момент: и пока опрос идёт, и после того как затих. */}
              <p className="text-xs text-dark-400">{t('deviceFirst.refreshStatusHint')}</p>
              {confirmAbandon ? (
                <div className="space-y-3 rounded-xl border border-warning-500/40 bg-warning-500/10 p-4">
                  <p className="text-sm font-semibold text-dark-100">
                    {t('deviceFirst.abandonTitle')}
                  </p>
                  <p className="text-sm text-dark-300">{t('deviceFirst.abandonText')}</p>
                  <button
                    type="button"
                    disabled={abandonMutation.isPending}
                    onClick={() => abandonMutation.mutate()}
                    className={`w-full rounded-xl bg-error-500 px-4 py-3 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                  >
                    {t('deviceFirst.abandonConfirm')}
                  </button>
                  <button
                    type="button"
                    disabled={abandonMutation.isPending}
                    onClick={() => setConfirmAbandon(false)}
                    className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 disabled:opacity-50 ${choiceClass}`}
                  >
                    {t('deviceFirst.abandonKeep')}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    // 🔴 Пункт 4.11а: было голое `returnToConfiguration`, а оно выбор из
                    // заказа не восстанавливает. На заказе, открытом из бота или с Главной,
                    // состояние компонента пустое — и человек, оформивший 5 устройств на
                    // 90 дней, молча падал в умолчание. Это ровно мина X, которую уже
                    // чинили. `startNewQuote` сначала запоминает выбор из строки заказа.
                    onClick={startNewQuote}
                    className={`min-h-11 w-full rounded-xl border border-dark-600 px-4 py-2 text-sm font-semibold text-dark-100 ${choiceClass}`}
                  >
                    {t('deviceFirst.changeOptions')}
                  </button>
                  {/* 🔴 Пункт 4.11а: кнопка отмены была покрашена `text-dark-500` — цветом
                      выключенных элементов, то есть выглядела неработающей. Красный ТЕКСТ с
                      иконкой, без заливки: заливка поставила бы отмену в зону большого пальца
                      наравне с оплатой и провоцировала случайные отмены. Акцентной остаётся
                      оплата. Отступ и волосяной разделитель отделяют её от кнопок действия. */}
                  {/* `mt-*` здесь не работает: обёртка — прямой ребёнок `space-y-4`, а его
                      правило специфичнее одиночного класса. Отступ даём паддингом. */}
                  <div className="border-t border-dark-700 pt-4">
                    <button
                      type="button"
                      onClick={() => setConfirmAbandon(true)}
                      className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-error-400 hover:bg-error-500/10 ${choiceClass}`}
                    >
                      <XIcon className="h-4 w-4" />
                      {t('deviceFirst.cancel')}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : requiresReconciliation ? (
            <>
              <StateMessage
                title={t('deviceFirst.paymentChecking')}
                text={t('deviceFirst.paymentCheckingText')}
              />
              <button
                type="button"
                onClick={refreshCheckout}
                className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
              >
                {t('deviceFirst.refreshStatus')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            </>
          ) : existingPaymentAttempt ? (
            <>
              <p role="status" className="text-sm text-warning-300">
                {t('deviceFirst.existingInvoice', {
                  method: paymentMethodLabel(existingPaymentAttempt.method_key),
                })}
              </p>
              <button
                type="button"
                onClick={() => openProviderLink(existingPaymentAttempt.redirect_url)}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.continueExistingInvoice')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            </>
          ) : (checkout.shortage_kopeks ?? 0) > 0 ? (
            <>
              {methods.isError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-error-400">
                    {t('deviceFirst.errorPaymentMethodsLoad')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void methods.refetch()}
                    className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
                  >
                    {t('deviceFirst.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/support')}
                    className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                  >
                    {t('deviceFirst.contactSupport')}
                  </button>
                </div>
              ) : methods.data && methods.data.methods.length === 0 ? (
                <div className="space-y-2">
                  <p role="status" className="text-sm text-warning-400">
                    {t('deviceFirst.noMethods')}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/support')}
                    className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                  >
                    {t('deviceFirst.contactSupport')}
                  </button>
                </div>
              ) : (
                <>
                  <div
                    role="radiogroup"
                    aria-label={t('deviceFirst.paymentMethodQuestion')}
                    className="grid gap-2"
                  >
                    {methods.data?.methods.map((method) => {
                      const isSelected = methodKey === method.key;
                      const availableKeys = methods.data?.methods.map((item) => item.key) ?? [];
                      return (
                        <button
                          key={method.key}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          onKeyDown={(event) =>
                            changeChoiceWithArrows(event, availableKeys, methodKey, setMethodKey)
                          }
                          onClick={() => setMethodKey(method.key)}
                          className={`rounded-xl border p-3 text-left text-sm ${choiceClass} ${
                            isSelected
                              ? 'border-accent-400 bg-accent-500/10 text-accent-300'
                              : 'border-dark-700 text-dark-300'
                          }`}
                        >
                          {paymentMethodLabel(method.key)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={paymentMutation.isPending || !methods.data?.methods.length}
                    onClick={() => paymentMutation.mutate()}
                    className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                  >
                    {t('deviceFirst.topUpAmount', {
                      amount: formatPrice(checkout.shortage_kopeks ?? 0),
                    })}
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={armMutation.isPending}
              onClick={() => armMutation.mutate()}
              className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
            >
              {t('deviceFirst.continueAndOrder')}
            </button>
          )}
          {checkout.settlement_mode !== 'direct_purchase_v2' &&
            !requiresReconciliation &&
            !existingPaymentAttempt && (
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
              >
                {t('deviceFirst.cancel')}
              </button>
            )}
          {errorMessage && (
            <div role="alert" className="space-y-2 text-sm text-error-400">
              <p>{errorMessage}</p>
              {legacyTrialSupportAction}
            </div>
          )}
        </CheckoutSurface>
      )}

      {checkout && ['processing', 'provisioning'].includes(checkout.ui_state) && (
        <div className="space-y-4">
          <StateMessage
            title={t('deviceFirst.processing')}
            text={t('deviceFirst.processingText')}
          />
          <button
            type="button"
            onClick={refreshCheckout}
            className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
          >
            {t('deviceFirst.refreshStatus')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/support')}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
          >
            {t('deviceFirst.contactSupport')}
          </button>
        </div>
      )}
      {checkout?.ui_state === 'ready' && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.ready')} text={t('deviceFirst.readyText')} />
          <button
            type="button"
            onClick={() => navigate('/connection')}
            className="w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white"
          >
            {t('deviceFirst.connectVpn')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
          >
            {t('deviceFirst.home')}
          </button>
        </div>
      )}
      {checkout &&
        [
          'reprice_required',
          'conflict',
          'expired',
          'failed',
          'cancelled',
          'operator_review',
        ].includes(checkout.ui_state) && (
          <div className="space-y-4">
            <StateMessage
              title={
                checkout.ui_state === 'operator_review'
                  ? t(operatorReviewCopy(checkout.money_state).titleKey)
                  : closedCart
                    ? t(closedCart.titleKey)
                    : checkout.terminal_reason === 'payment_amount_mismatch'
                      ? t('deviceFirst.paymentMismatchTitle')
                      : t('deviceFirst.refreshTitle')
              }
              text={
                checkout.ui_state === 'operator_review'
                  ? t(operatorReviewCopy(checkout.money_state).textKey)
                  : closedCart
                    ? t(closedCart.textKey)
                    : checkout.terminal_reason === 'payment_amount_mismatch'
                      ? t('deviceFirst.paymentMismatchText')
                      : t('deviceFirst.refreshText')
              }
            />
            {checkout.ui_state === 'operator_review' ? (
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            ) : (
              <button
                type="button"
                onClick={startNewQuote}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.startNew')}
              </button>
            )}
          </div>
        )}

      {errorMessage && !modalOpen && !confirmation && !resumedConfirmation && !legacyDraft && (
        <div role="alert" className="mt-4 space-y-2 text-sm text-error-400">
          <p>{errorMessage}</p>
          {legacyTrialSupportAction}
        </div>
      )}
    </section>
  );
}

function CheckoutSurface({
  label,
  portal,
  dialogRef,
  onKeyDown,
  children,
}: {
  label: string;
  portal: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const dialog = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={portal || undefined}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-dark-700 bg-dark-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl focus:outline-none"
    >
      {children}
    </div>
  );
  if (!portal) return <div className="space-y-4">{children}</div>;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end bg-black/70 p-0 sm:items-center sm:justify-center sm:p-6">
      {dialog}
    </div>,
    document.body,
  );
}

// A `configuration` row (draft) is only ever born by a deprecated showcase
// bundle: the pay-time model never creates drafts. A `confirmation` row is a
// legacy draft ONLY without direct settlement — a fused-born direct
// confirmation is a live order interrupted between its pay-time birth and the
// payment attempt (a lost response, a concurrent pay click losing its race).
// It must be resumed by the row's own data, never cancelled from a drain
// screen: cancelling it could kill a concurrent winner's live order.
function isShowcaseDraft(checkout: DeviceFirstCheckout): boolean {
  return (
    checkout.ui_state === 'configuration' ||
    (checkout.ui_state === 'confirmation' && checkout.settlement_mode !== 'direct_purchase_v2')
  );
}

function deviceFirstErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: { data?: { detail?: unknown } } }).response;
  const detail = response?.data?.detail;
  if (!detail || typeof detail !== 'object') return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function deviceFirstErrorMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  const messages: Record<string, string> = {
    open_checkout_exists: 'deviceFirst.errorResumeOrder',
    open_checkout_recovery_failed: 'deviceFirst.errorResumeUnavailable',
    device_limit_decrease_not_allowed: 'deviceFirst.errorDeviceLimitDecrease',
    subscription_restricted: 'deviceFirst.errorRestricted',
    account_closing: 'deviceFirst.errorRestricted',
    invalid_selection: 'deviceFirst.errorSelectionChanged',
    invalid_funding_request: 'deviceFirst.error',
    invalid_state: 'deviceFirst.errorOrderUpdated',
    // ⚠️ Волна 2: без этой строки отказ падал в безликое «Не удалось выполнить действие.
    // Попробуйте ещё раз» — то есть звал повторить ровно то, откуда его только что отбили.
    // Текст взят слово в слово из ботовой половины и про деньги не утверждает ничего.
    invoice_terminal: 'deviceFirst.errorInvoiceTerminal',
    quote_expired: 'deviceFirst.errorOrderUpdated',
    rate_limited: 'deviceFirst.errorRateLimited',
    concurrent_idempotency_key: 'deviceFirst.errorRateLimited',
    idempotency_conflict: 'deviceFirst.errorRetryQuote',
    idempotency_key_required: 'deviceFirst.error',
    reconciliation_required: 'deviceFirst.errorPaymentChecking',
    legacy_trial_reconciliation_required: 'deviceFirst.errorLegacyTrialReconciliation',
    external_invoice_active: 'deviceFirst.errorPaymentChecking',
    // Свой текст, а не общий «мы проверяем созданный счёт, не оплачивайте повторно»:
    // сюда человек попадает, когда пытается заплатить, и счёта у него может не быть вовсе.
    operator_review_required: 'deviceFirst.errorOperatorReview',
    payment_method_required: 'deviceFirst.errorPaymentMethod',
    payment_method_unavailable: 'deviceFirst.errorPaymentMethod',
    payment_methods_load_failed: 'deviceFirst.errorPaymentMethodsLoad',
    provider_amount_out_of_range: 'deviceFirst.errorProviderAmount',
    funding_mode_locked: 'deviceFirst.errorFundingLocked',
    wallet_insufficient: 'deviceFirst.errorWalletInsufficient',
    funding_not_required: 'deviceFirst.errorOrderUpdated',
    feature_disabled: 'deviceFirst.errorUnavailable',
    legacy_only: 'deviceFirst.errorUnavailable',
    cabinet_return_unavailable: 'deviceFirst.errorUnavailable',
  };
  return t(messages[deviceFirstErrorCode(error) ?? ''] ?? 'deviceFirst.error');
}

function Summary({
  checkout,
  formatPrice,
}: {
  checkout: DeviceFirstCheckout;
  formatPrice: (value: number) => string;
}) {
  const { t } = useTranslation();
  const periodText =
    checkout.period_days === 365
      ? t('deviceFirst.periodYearExact')
      : checkout.period_days % 30 === 0
        ? t('deviceFirst.periodMonths', { count: checkout.period_days / 30 })
        : t('deviceFirst.periodDays', { count: checkout.period_days });
  return (
    <div className="space-y-3 rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.devices')}</span>
        <strong>
          {checkout.current_device_limit !== null &&
          checkout.current_subscription_is_trial === false
            ? `${checkout.current_device_limit} → ${checkout.selected_device_limit}`
            : checkout.selected_device_limit}
        </strong>
      </div>
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.period')}</span>
        <strong>{periodText}</strong>
      </div>
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.endsAt')}</span>
        <strong>
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
            new Date(checkout.estimated_end_at),
          )}
        </strong>
      </div>
      {checkout.balance_kopeks !== null && (
        <div className="flex justify-between text-sm text-dark-300">
          <span>{t('deviceFirst.balance')}</span>
          <strong>{formatPrice(checkout.balance_kopeks)}</strong>
        </div>
      )}
      {checkout.settlement_mode !== 'direct_purchase_v2' &&
        checkout.shortage_kopeks !== null &&
        checkout.shortage_kopeks > 0 && (
          <div className="flex justify-between text-sm text-warning-300">
            <span>{t('deviceFirst.shortage')}</span>
            <strong>{formatPrice(checkout.shortage_kopeks)}</strong>
          </div>
        )}
      <div className="flex justify-between border-t border-dark-700 pt-3 text-dark-50">
        <span>{t('deviceFirst.total')}</span>
        <strong>{formatPrice(checkout.tariff_total_kopeks || checkout.quoted_price_kopeks)}</strong>
      </div>
    </div>
  );
}

function StateMessage({ title, text }: { title: string; text: string }) {
  return (
    <div role="status" aria-live="polite" className="py-8 text-center">
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-accent-500/15 ring-1 ring-accent-400/30" />
      <h3 className="text-lg font-bold text-dark-50">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-dark-400">{text}</p>
    </div>
  );
}

/**
 * The local confirmation summary. No durable checkout exists at this step, so
 * every figure comes from the server-owned purchase options rather than from
 * a quote row. The end date is deliberately absent: only the server knows the
 * exact base date an extension would prolong.
 */
function SelectionSummary({
  periodDays,
  deviceLimit,
  priceKopeks,
  balanceKopeks,
  currentDeviceLimit,
  formatPrice,
}: {
  periodDays: number;
  deviceLimit: number;
  priceKopeks: number | null;
  balanceKopeks: number | null;
  currentDeviceLimit: number | null;
  formatPrice: (value: number) => string;
}) {
  const { t } = useTranslation();
  const periodText =
    periodDays === 365
      ? t('deviceFirst.periodYearExact')
      : periodDays % 30 === 0
        ? t('deviceFirst.periodMonths', { count: periodDays / 30 })
        : t('deviceFirst.periodDays', { count: periodDays });
  return (
    <div className="space-y-3 rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.devices')}</span>
        <strong>
          {currentDeviceLimit !== null ? `${currentDeviceLimit} → ${deviceLimit}` : deviceLimit}
        </strong>
      </div>
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.period')}</span>
        <strong>{periodText}</strong>
      </div>
      {balanceKopeks !== null && (
        <div className="flex justify-between text-sm text-dark-300">
          <span>{t('deviceFirst.balance')}</span>
          <strong>{formatPrice(balanceKopeks)}</strong>
        </div>
      )}
      {balanceKopeks !== null && priceKopeks !== null && balanceKopeks < priceKopeks && (
        <div className="flex justify-between text-sm text-warning-300">
          <span>{t('deviceFirst.shortage')}</span>
          <strong>{formatPrice(priceKopeks - balanceKopeks)}</strong>
        </div>
      )}
      <div className="flex justify-between border-t border-dark-700 pt-3 text-dark-50">
        <span>{t('deviceFirst.total')}</span>
        <strong>{priceKopeks !== null ? formatPrice(priceKopeks) : '—'}</strong>
      </div>
    </div>
  );
}
