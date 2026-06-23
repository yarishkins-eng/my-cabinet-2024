import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subscriptionApi } from '../../api/subscription';
import { DEVICE_ALIAS_MAX_LENGTH } from '../../constants/devices';
import { useDestructiveConfirm } from '../../platform/hooks/useNativeDialog';
import { useHaptic } from '../../platform';
import { PencilIcon, TrashIcon, CheckIcon, XIcon } from '@/components/icons';
import type { Device } from '../../types';

/** Монитор-иконка устройства (currentColor наследует цвет строки). */
function DeviceGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4M8 21h8" />
    </svg>
  );
}

/**
 * «Мои устройства» — НИЗ объединённого экрана (Чат 3b, §16). Список подключённых
 * устройств + переименование/удаление + «Удалить все» + счётчик «k из N». Перенос из
 * `Subscription.tsx` (логика мутаций и edit-режима — без изменений), БЕЗ блока локаций/
 * серверов (§3/§16 — сняты с экрана).
 *
 * Данные устройств владеет страница (один запрос `['devices', subscriptionId]`, Чат 2) и
 * передаёт сюда пропсами — мутации инвалидируют тот же ключ, страница перечитывает.
 * Прячется при `accessEnded` (VPN мёртв) — это решает родитель, просто не рендерит панель.
 */
export default function DevicesPanel({
  subscriptionId,
  devices,
  total,
  deviceLimit,
  isLoading,
}: {
  subscriptionId: number | undefined;
  devices: Device[];
  total: number;
  /** 0 = БЕЗЛИМИТ устройств (не «0 устройств»!). */
  deviceLimit: number;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const haptic = useHaptic();
  const destructiveConfirm = useDestructiveConfirm();

  // Только одно устройство в режиме правки — hwid служит и переключателем, и id строки.
  const [editingHwid, setEditingHwid] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const renameMutation = useMutation({
    mutationFn: ({ hwid, name }: { hwid: string; name: string | null }) =>
      subscriptionApi.renameDevice(hwid, name, subscriptionId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
      haptic.notification('success');
      // Не сбрасываем edit-state, если пользователь уже перешёл на другое устройство.
      setEditingHwid((current) => (current === variables.hwid ? null : current));
    },
    onError: () => {
      haptic.notification('error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (hwid: string) => subscriptionApi.deleteDevice(hwid, subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => subscriptionApi.deleteAllDevices(subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
    },
  });

  const saveRename = (hwid: string) => {
    const trimmed = editingName.trim();
    renameMutation.mutate({ hwid, name: trimmed || null });
  };

  const counter =
    deviceLimit === 0
      ? t('home.hero.devicesCounterUnlimited', { used: total })
      : t('home.hero.devicesCounter', { used: total, max: deviceLimit });

  return (
    <section className="rounded-2xl border border-dark-50/10 bg-dark-50/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-dark-50">{t('subscription.myDevices')}</h2>
        {devices.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const confirmed = await destructiveConfirm(
                t('subscription.confirmDeleteAllDevices'),
                t('subscription.deleteAllDevices'),
                t('subscription.deleteAllDevices'),
              );
              if (confirmed) deleteAllMutation.mutate();
            }}
            disabled={deleteAllMutation.isPending}
            className="text-[11px] font-medium text-error-400 transition-colors hover:text-error-300 disabled:opacity-50"
          >
            {t('subscription.deleteAllDevices')}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        </div>
      ) : devices.length > 0 ? (
        <div className="space-y-2">
          <div className="mb-1 px-1 text-[11px] text-dark-50/40">{counter}</div>
          {devices.map((device) => {
            const isEditing = editingHwid === device.hwid;
            // Приоритет имени: пользовательский алиас → модель → платформа.
            const name =
              (device.local_name && device.local_name.trim()) ||
              device.device_model ||
              device.platform;

            return (
              <div
                key={device.hwid}
                className="flex items-center justify-between rounded-xl border border-dark-50/[0.08] bg-dark-50/[0.03] p-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-dark-50/[0.06] text-dark-50/50">
                    <DeviceGlyph />
                  </span>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingName}
                        maxLength={DEVICE_ALIAS_MAX_LENGTH}
                        placeholder={device.device_model || device.platform}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveRename(device.hwid);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingHwid(null);
                            setEditingName('');
                          }
                        }}
                        className="w-full rounded-md bg-dark-50/[0.06] px-2 py-1 text-sm font-semibold text-dark-50 outline-none focus:ring-1 focus:ring-accent-400/40"
                      />
                    ) : (
                      <div className="truncate text-sm font-semibold text-dark-50">{name}</div>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dark-50/30">
                      <span className="truncate">{device.platform}</span>
                      <span className="font-mono text-dark-50/20">
                        {device.hwid.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveRename(device.hwid)}
                        disabled={renameMutation.isPending}
                        className="p-2 text-dark-50/60 transition-colors hover:text-accent-300 disabled:opacity-50"
                        title={t('subscription.renameDeviceSave')}
                        aria-label={t('subscription.renameDeviceSave')}
                      >
                        <CheckIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingHwid(null);
                          setEditingName('');
                        }}
                        disabled={renameMutation.isPending}
                        className="p-2 text-dark-50/40 transition-colors hover:text-dark-50/70 disabled:opacity-50"
                        title={t('subscription.renameDeviceCancel')}
                        aria-label={t('subscription.renameDeviceCancel')}
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingHwid(device.hwid);
                          setEditingName(device.local_name || '');
                        }}
                        className="p-2 text-dark-50/40 transition-colors hover:text-dark-50/70"
                        title={t('subscription.renameDevice')}
                        aria-label={t('subscription.renameDevice')}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const confirmed = await destructiveConfirm(
                            t('subscription.confirmDeleteDevice'),
                            t('subscription.deleteDevice'),
                            t('subscription.deleteDevice'),
                          );
                          if (confirmed) deleteMutation.mutate(device.hwid);
                        }}
                        disabled={deleteMutation.isPending}
                        className="p-2 text-dark-50/40 transition-colors hover:text-error-400 disabled:opacity-50"
                        title={t('subscription.deleteDevice')}
                        aria-label={t('subscription.deleteDevice')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center text-[12px] text-dark-50/30">
          {t('subscription.noDevices')}
        </div>
      )}
    </section>
  );
}
