import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SettingDefinition, adminSettingsApi } from '../../api/adminSettings';
import { StarIcon } from './icons';
import { SettingsTableRow } from './SettingsTableRow';
import { settingSaveErrorKey } from './utils';
import { useToast } from '../Toast';

interface FavoritesTabProps {
  settings: SettingDefinition[];
  isFavorite: (key: string) => boolean;
  toggleFavorite: (key: string) => void;
}

export function FavoritesTab({ settings, isFavorite, toggleFavorite }: FavoritesTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // Отказ сервера говорим словами: раньше переключатель молча возвращался назад (мина NM). Список
  // перечитываем — если ключ успели задать на сервере, строка сама покажет замок.
  const onError = (action: 'save' | 'reset') => (error: unknown) => {
    queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    showToast({ type: 'error', message: t(settingSaveErrorKey(error, action)) });
  };

  const updateSettingMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      adminSettingsApi.updateSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: onError('save'),
  });

  const resetSettingMutation = useMutation({
    mutationFn: (key: string) => adminSettingsApi.resetSetting(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: onError('reset'),
  });

  if (settings.length === 0) {
    return (
      <div className="rounded-2xl border border-dark-700/30 bg-dark-800/30 p-12 text-center">
        <div className="mb-4 flex justify-center text-dark-500">
          <StarIcon filled={false} />
        </div>
        <p className="text-dark-400">{t('admin.settings.favoritesEmpty')}</p>
        <p className="mt-1 text-sm text-dark-500">{t('admin.settings.favoritesHint')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-dark-700/40">
      {settings.map((setting, idx) => (
        <SettingsTableRow
          key={setting.key}
          setting={setting}
          isFavorite={isFavorite(setting.key)}
          onToggleFavorite={() => toggleFavorite(setting.key)}
          onUpdate={(value) => updateSettingMutation.mutate({ key: setting.key, value })}
          onReset={() => resetSettingMutation.mutate(setting.key)}
          isUpdating={updateSettingMutation.isPending}
          isResetting={resetSettingMutation.isPending}
          isLast={idx === settings.length - 1}
        />
      ))}
    </div>
  );
}
