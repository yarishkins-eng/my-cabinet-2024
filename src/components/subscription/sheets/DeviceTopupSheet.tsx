import { useTranslation } from 'react-i18next';

import { ChevronRightIcon } from '@/components/icons';
import { DeviceAddonFlow } from '../DeviceAddonFlow';
import type { PurchaseOptions, Subscription } from '@/types';

export interface DeviceTopupSheetProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  subscription: Subscription;
  subscriptionId: number | undefined;
  devicesToAdd: number;
  onDevicesToAddChange: (n: number) => void;
  /** Kept for callers while the owned flow becomes the monetary authority. */
  purchaseOptions: PurchaseOptions | undefined;
  isDark: boolean;
}

/** Shared visual shell; DeviceAddonFlow owns every financial command. */
export function DeviceTopupSheet({
  open,
  onOpen,
  onClose,
  subscription,
  subscriptionId,
  devicesToAdd,
  onDevicesToAddChange,
  isDark,
}: DeviceTopupSheetProps) {
  const { t } = useTranslation();
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`w-full rounded-xl border p-4 text-left transition-colors ${isDark ? 'border-dark-700/50 bg-dark-800/50 hover:border-dark-600' : 'border-champagne-300/60 bg-champagne-200/40 hover:border-champagne-400'}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-dark-100">
              {t('subscription.additionalOptions.buyDevices')}
            </div>
            <div className="mt-1 text-sm text-dark-400">
              {t('subscription.additionalOptions.currentDeviceLimit', {
                count: subscription.device_limit,
              })}
            </div>
          </div>
          <ChevronRightIcon className="text-dark-400" />
        </div>
      </button>
    );
  }
  if (!subscriptionId) return null;
  return (
    <div
      className={`rounded-xl border p-5 ${isDark ? 'border-dark-700/50 bg-dark-800/50' : 'border-champagne-300/60 bg-champagne-200/40'}`}
    >
      <DeviceAddonFlow
        subscriptionId={subscriptionId}
        initialDevices={devicesToAdd}
        onClose={() => {
          onDevicesToAddChange(1);
          onClose();
        }}
      />
    </div>
  );
}
