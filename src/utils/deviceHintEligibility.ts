export interface DeviceHintEligibilityInput {
  hasSubscription: boolean;
  hasSubscriptionId: boolean;
  devicesLoaded: boolean;
  deviceZoneKind: string;
  screenCode: string | null;
  hasBeenSeen: boolean;
  successModalOpen: boolean;
}

/** Подсказка нужна только перед самым первым подключением. */
export function isDeviceHintEligible({
  hasSubscription,
  hasSubscriptionId,
  devicesLoaded,
  deviceZoneKind,
  screenCode,
  hasBeenSeen,
  successModalOpen,
}: DeviceHintEligibilityInput): boolean {
  return (
    hasSubscription &&
    hasSubscriptionId &&
    devicesLoaded &&
    deviceZoneKind === 'connect' &&
    (screenCode === 'T1' || screenCode === 'P1') &&
    !hasBeenSeen &&
    !successModalOpen
  );
}
