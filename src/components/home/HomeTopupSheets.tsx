import { DeviceTopupSheet } from '../subscription/sheets/DeviceTopupSheet';
import { TrafficTopupSheet } from '../subscription/sheets/TrafficTopupSheet';
import { useCloseOnSuccessNotification } from '../../store/successNotification';
import type { PurchaseOptions, Subscription } from '../../types';

/**
 * Шторки докупки для объединённого экрана (Чат 3b) — устройства и гигабайты.
 *
 * Этот файл — отдельный lazy-чанк (импортируется через `lazy()` в `DashboardUnified`),
 * чтобы код шторок НЕ попадал в eager-бандл «/» (§19 п.4). Сами шторки — те же, что у
 * детальной страницы (`DeviceTopupSheet`/`TrafficTopupSheet`): они self-владеют своими
 * запросами цены/пакетов и мутацией покупки; сюда передаём только подписку/id/состояние.
 *
 * 🔴 `purchaseOptions` (баланс) приходит ГОТОВЫМ из страницы — иначе кнопка «Купить» не
 * блокируется при нулевом балансе и пользователь ловит голую серверную ошибку (§19 п.4).
 *
 * Шторки рисуем как контролируемые панели: монтируем ТОЛЬКО когда открыты, и всегда
 * `open` — их собственная свёрнутая кнопка-триггер не показывается (триггер — hero-кнопка
 * сверху / пилюля в баннере). `onOpen` им не нужен → no-op.
 *
 * cross-sheet-reset: при глобальном success-уведомлении (напр. оплата прошла через WS)
 * закрываем обе шторки — паритет с детальной (`handleCloseAllModals`).
 */
const noop = () => {};

export default function HomeTopupSheets({
  subscription,
  subscriptionId,
  isDark,
  purchaseOptions,
  showDeviceTopup,
  showTrafficTopup,
  devicesToAdd,
  onDevicesToAddChange,
  selectedTrafficPackage,
  onSelectedTrafficPackageChange,
  onCloseDevice,
  onCloseTraffic,
}: {
  subscription: Subscription;
  subscriptionId: number | undefined;
  isDark: boolean;
  purchaseOptions: PurchaseOptions | undefined;
  showDeviceTopup: boolean;
  showTrafficTopup: boolean;
  devicesToAdd: number;
  onDevicesToAddChange: (n: number) => void;
  selectedTrafficPackage: number | null;
  onSelectedTrafficPackageChange: (gb: number | null) => void;
  onCloseDevice: () => void;
  onCloseTraffic: () => void;
}) {
  useCloseOnSuccessNotification(() => {
    onCloseDevice();
    onCloseTraffic();
  });

  return (
    <div className="space-y-3">
      {showDeviceTopup && (
        <DeviceTopupSheet
          open
          onOpen={noop}
          onClose={onCloseDevice}
          subscription={subscription}
          subscriptionId={subscriptionId}
          devicesToAdd={devicesToAdd}
          onDevicesToAddChange={onDevicesToAddChange}
          purchaseOptions={purchaseOptions}
          isDark={isDark}
        />
      )}
      {showTrafficTopup && (
        <TrafficTopupSheet
          open
          onOpen={noop}
          onClose={onCloseTraffic}
          subscription={subscription}
          subscriptionId={subscriptionId}
          selectedTrafficPackage={selectedTrafficPackage}
          onSelectedTrafficPackageChange={onSelectedTrafficPackageChange}
          purchaseOptions={purchaseOptions}
          isDark={isDark}
        />
      )}
    </div>
  );
}
