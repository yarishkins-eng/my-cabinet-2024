import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { DeviceAddonFlow } from '@/components/subscription/DeviceAddonFlow';
import { deviceAddonApi } from '@/api/deviceAddon';

export default function DeviceAddon() {
  const { t } = useTranslation();
  const { intentId } = useParams<{ intentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const subscriptionId = Number(searchParams.get('subscription_id'));
  const devices = Number(searchParams.get('devices'));
  const attemptId = searchParams.get('attempt') || undefined;

  if (!intentId && (!Number.isInteger(subscriptionId) || subscriptionId <= 0)) {
    return (
      <p className="py-10 text-center text-sm text-error-400">
        {t('subscription.deviceAddon.openError')}
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-lg py-4">
      <DeviceAddonFlow
        subscriptionId={intentId ? 0 : subscriptionId}
        initialDevices={Number.isInteger(devices) && devices > 0 ? devices : 1}
        intentId={intentId}
        attemptId={attemptId}
        onClose={() => navigate('/')}
      />
    </div>
  );
}

/** Resolves a Telegram dtu UUID through the owner-only API before rendering it. */
export function DeviceAddonPaymentResolver() {
  const { t } = useTranslation();
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const attempt = useQuery({
    queryKey: ['device-addon-topup', attemptId],
    queryFn: () => deviceAddonApi.getTopup(attemptId!),
    enabled: Boolean(attemptId),
    retry: 2,
  });
  useEffect(() => {
    if (!attempt.data) return;
    navigate(
      `/subscription/device-topup/${attempt.data.intent.id}?attempt=${encodeURIComponent(attempt.data.attempt.id)}`,
      { replace: true },
    );
  }, [attempt.data, navigate]);
  if (attempt.isError)
    return (
      <p className="py-10 text-center text-sm text-error-400">
        {t('subscription.deviceAddon.attemptNotFound')}
      </p>
    );
  return (
    <div className="flex justify-center py-10">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
    </div>
  );
}
