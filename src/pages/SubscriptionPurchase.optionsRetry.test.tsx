// @vitest-environment jsdom

// 🔴 РЕК-3.1, сторож мины FH. Проверяет НАСТОЯЩИЙ react-query, а не подделку: подмена
// `useQuery` (как в соседнем `SubscriptionPurchase.recovery.test.tsx`) сделала бы сторожа
// круговым — решает исход ровно та опция запроса, которую подделка и стирает.
// ⚠️ `retryDelay: 0` в тестовом клиенте меняет ПАУЗУ между попытками, а не их число:
// собственный `retry` компонента перекрывает умолчание клиента, поэтому возврат правки
// к `retry: false` этот сторож увидит.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SubscriptionPurchase from './SubscriptionPurchase';
import { deviceFirstApi } from '@/api/deviceFirst';
import { subscriptionApi } from '../api/subscription';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
vi.mock('@/components/WebBackButton', () => ({
  WebBackButton: () => <button type="button">back</button>,
}));
vi.mock('@/components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: () => <div data-testid="device-first-configurator" />,
}));
// Ветка «касса не положена» рисует старую сетку тарифов целиком; её тяжёлые дети к предмету
// проверки отношения не имеют, но без них дерево падает. Подменяем только их, не сетку —
// именно сетку сторож и должен увидеть (или не увидеть).
vi.mock('../components/subscription/sheets/SwitchTariffSheet', () => ({
  SwitchTariffSheet: () => null,
}));
vi.mock('../components/subscription/purchase/TariffPurchaseForm', () => ({
  TariffPurchaseForm: () => null,
}));
vi.mock('../components/subscription/purchase/ClassicPurchaseWizard', () => ({
  ClassicPurchaseWizard: () => null,
}));
// Та самая «старая сетка тарифов», на которую роняет мина FH. Подменена меткой, чтобы сторож
// говорил про НЕЁ прямо, а не про случайную надпись внутри неё.
vi.mock('../components/subscription/purchase/TariffPickerGrid', () => ({
  TariffPickerGrid: () => <div data-testid="old-tariff-grid" />,
}));

const PURCHASE_OPTIONS = {
  sales_mode: 'tariffs',
  tariffs: [{ id: 3, name: 'Базовый' }],
} as unknown as Awaited<ReturnType<typeof subscriptionApi.getPurchaseOptions>>;

function renderPurchase() {
  // ⛔ Никаких `retry: false` и никакого `retryDelay` здесь: и то и другое стёрло бы предмет
  // проверки — компонент задаёт обе опции сам, и сторож обязан мерить именно их.
  // (Прежняя редакция ставила `logger` — это API react-query v4, в установленной v5 он
  //  игнорируется; ревью поймало. Убран, чтобы не выглядел работающим.)
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/subscription/purchase?from=checkout&period=30&devices=2']}>
        <SubscriptionPurchase />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('РЕК-3.1 · мина FH: осечка сети не роняет человека на старую сетку тарифов', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('переспрашивает опции кассы после сетевой осечки и всё равно рисует кассу', async () => {
    const getOptions = vi
      .spyOn(deviceFirstApi, 'getOptions')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ eligible: true });
    vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({
      subscription: null,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscription>>);
    vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(PURCHASE_OPTIONS);
    vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
      multi_tariff_enabled: false,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);

    renderPurchase();

    await waitFor(() => expect(screen.getByTestId('device-first-configurator')).toBeTruthy());
    // 🔴 Число попыток проверяем ТОЧНО, а не «больше одной»: ревью показало, что при
    // «больше одной» удаление опции целиком оставило бы сторож зелёным — запрос свалился бы
    // на глобальное умолчание `retry: 1` (`src/main.tsx`), то есть на две попытки.
    expect(getOptions).toHaveBeenCalledTimes(2);
    // И человек не оказался на старой сетке тарифов — ровно то, чем била мина FH.
    expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  });

  // 🔴 Обратная половина, и она про ЦЕНУ правки. Таймаут повторять нельзя: он уже стоил
  // тридцать секунд, а вторая и третья попытки стоят столько же — человек смотрел бы голый
  // спиннер до полутора минут. Без этого сторожа возврат к слепому `retry: 2` прошёл бы
  // незамеченным: набор тестов время не мерит.
  it('таймаут НЕ переспрашивает — иначе спиннер живёт минуты, а не секунды', async () => {
    const timeout = Object.assign(new Error('timeout of 30000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    const getOptions = vi.spyOn(deviceFirstApi, 'getOptions').mockRejectedValue(timeout);
    vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({
      subscription: null,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscription>>);
    vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(PURCHASE_OPTIONS);
    vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
      multi_tariff_enabled: false,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);

    renderPurchase();

    // Заслон загрузки снят с ОДНОГО отказа — то есть повторов не было и человек не ждал
    // впустую. Цена этого честно названа: кассы он не увидит, это и есть остаток мины FH,
    // которую правка сужает, но не снимает.
    await waitFor(() => expect(screen.getByTestId('old-tariff-grid')).toBeTruthy());
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('device-first-configurator')).toBeNull();
  });

  // 🔴 ВТОРАЯ ПОЛОВИНА ЗАЩИТЫ ОТ СТАРОГО БАЛАНСА (находка трёх линз ревью). Снос кэша на
  // экране результата помогает только потому, что этот экран без данных держит загрузку и
  // НЕ рисует кассу. Уберут `deviceFirstLoading` из условия — и приземление снова сможет
  // открыться на пустых или чужих деньгах.
  it('без ответа сервера касса не рисуется вовсе — держится загрузка', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockImplementation(
      () => new Promise(() => {}) as ReturnType<typeof deviceFirstApi.getOptions>,
    );
    vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({
      subscription: null,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscription>>);
    vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(PURCHASE_OPTIONS);
    vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
      multi_tariff_enabled: false,
    } as unknown as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);

    renderPurchase();

    await waitFor(() => expect(subscriptionApi.getPurchaseOptions).toHaveBeenCalled());
    // Экран держит загрузку: ни кассы, ни старой сетки тарифов.
    expect(screen.queryByTestId('device-first-configurator')).toBeNull();
    expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  });
});
