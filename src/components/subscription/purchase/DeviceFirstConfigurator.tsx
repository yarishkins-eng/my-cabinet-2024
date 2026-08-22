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
  const markLeavingToPay = useCallback(() => {
    // 🔴 Оба выхода наружу обязаны отмечаться одинаково: и кнопка оплаты, и «скопировать
    // ссылку». Пока это знал только первый, человек, оплативший ПО СКОПИРОВАННОЙ ссылке,
    // возвращался на экран, который не перечитывал заказ и уже замолчал по порогу, — а
    // подпись под кнопкой обещала ему «заказ обновится сам». Нашла волна ревью, не я.
    paymentLinkOpenedRef.current = true;
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
    retry: false,
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
    // Владелец поймал это после отмены заказа; на деле сюда приводит и автоматический
    // возврат при отмене счёта провайдером (эффект `provider_terminal:` ниже), то есть каждая брошенная
    // корзина, оплачивавшаяся через СБП.
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
    if (statusQuery.data) setCheckout(statusQuery.data);
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

  const armMutation = useMutation({
    mutationFn: () => deviceFirstApi.arm(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: acceptCheckout,
    onError: setActionError,
  });
  const recoverAmbiguousCheckout = async (error: unknown) => {
    setActionError(error);
    if (deviceFirstErrorCode(error) === 'invoice_terminal') {
      // The server archived a provider-verified cancelled/expired invoice.
      // It has no active money path, so return straight to a fresh choice
      // instead of trapping the customer on a technical error screen.
      returnToConfiguration();
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
  // а он живёт с `retry: false`: одна сетевая осечка — и человек остаётся на экране БЕЗ
  // ЕДИНОГО способа заплатить. Пока мы уходили редиректом, это было незаметно, адрес держали
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
  useEffect(() => {
    if (
      checkout?.ui_state === 'cancelled' &&
      checkout.terminal_reason?.startsWith('provider_terminal:')
    ) {
      rememberSelection(checkout);
      returnToConfiguration();
    }
  }, [
    checkout?.terminal_reason,
    checkout?.ui_state,
    checkout,
    rememberSelection,
    returnToConfiguration,
  ]);
  const pendingPayment = useQuery({
    queryKey: ['device-first-pending-payment', checkout?.id],
    queryFn: () => deviceFirstApi.getPendingPayment(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      checkout?.settlement_mode === 'direct_purchase_v2' &&
      checkout.ui_state === 'awaiting_payment',
    retry: false,
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

    // Validated: mirror the selection locally so a failure lands on an honest
    // confirmation screen, then fire the only automatic financial call. The
    // fused endpoint verifies the signed Telegram identity before any order
    // exists and reuses the same durable idempotency/one-invoice protections
    // as a manual pay click.
    setPeriod(periodDays);
    setDevices(deviceLimit);
    setConfirmation(true);
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

      {!checkout && initialCheckoutId && restoredCheckout.isLoading && (
        <StateMessage title={t('deviceFirst.processing')} text={t('deviceFirst.processingText')} />
      )}
      {!checkout && initialCheckoutId && restoredCheckout.isError && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.refreshTitle')} text={t('deviceFirst.refreshText')} />
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
                balanceKopeks={confirmBalanceKopeks}
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
              <p className="text-xs text-dark-400">{t('deviceFirst.chargeNotice')}</p>
              {!confirmSelectionAvailable || confirmTotalKopeks === null ? (
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
              ) : methods.isLoading ? (
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
                  <p className="text-sm text-dark-300">
                    {t('deviceFirst.paymentMethodsAvailable')}
                  </p>
                  {/* 🔴 Пункт 4.11а: здесь стояло предупреждение «страница оплаты откроется
                      вместо кабинета» (мина W). Оно было правдой, пока тап по способу оплаты
                      уводил к провайдеру. Теперь тап создаёт счёт и показывает НАШ экран
                      счёта — старый текст стал бы ложью. На самом экране счёта, где уход
                      по-прежнему настоящий, оно осталось. Вместо него — честное ожидание:
                      покупка стала двухтаповой, и кнопка с суммой читается как «заплатить». */}
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
              {actionErrorCode === 'wallet_insufficient' && (
                <button
                  type="button"
                  onClick={() => navigate('/balance')}
                  className={`w-full rounded-xl border border-accent-400/50 px-4 py-3 text-sm font-semibold text-accent-200 ${choiceClass}`}
                >
                  {confirmTotalKopeks !== null && (confirmBalanceKopeks ?? 0) < confirmTotalKopeks
                    ? t('deviceFirst.topUpAmount', {
                        amount: formatPrice(confirmTotalKopeks - (confirmBalanceKopeks ?? 0)),
                      })
                    : t('deviceFirst.needTopup')}
                </button>
              )}
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
