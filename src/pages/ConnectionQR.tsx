import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useBranding } from '../hooks/useBranding';
import { AdminBackButton } from '@/components/admin';
import { subscriptionApi } from '../api/subscription';
import { resolveConnectionUrlForUi } from '../utils/connectionLink';
import { strictTestLinkEpoch } from '../utils/testLinkFence';
import type { AppConfig } from '../types';

interface ConnectionQRState {
  url: string;
  hideLink: boolean;
  subscriptionId?: number;
  testResetAt?: string | null;
}

function isValidState(state: unknown): state is ConnectionQRState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return typeof s.url === 'string' && s.url.length > 0 && typeof s.hideLink === 'boolean';
}

export default function ConnectionQR() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { appName } = useBranding();

  const state = location.state as unknown;
  const validState = isValidState(state) ? state : null;
  const subId = validState?.subscriptionId;
  const connectionPath = subId ? `/connection?sub=${subId}` : '/connection';
  const {
    data: appConfig,
    isFetchedAfterMount: appConfigFetchedAfterMount,
    isError: isAppConfigError,
    isFetching: isAppConfigFetching,
  } = useQuery<AppConfig>({
    queryKey: ['appConfig', subId],
    queryFn: () => subscriptionApi.getAppConfig(subId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: validState != null,
  });
  const {
    data: connectionLink,
    isFetching: isConnectionLinkFetching,
    isError: isConnectionLinkError,
  } = useQuery({
    queryKey: ['connectionLink', subId],
    queryFn: () => subscriptionApi.getConnectionLink(subId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: validState != null,
  });
  const {
    data: subscriptionResponse,
    isFetchedAfterMount: subscriptionFetchedAfterMount,
    isError: isSubscriptionError,
    isFetching: isSubscriptionFetching,
  } = useQuery({
    queryKey: ['subscription', subId],
    queryFn: () => subscriptionApi.getSubscription(subId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: validState != null,
  });

  const resetFence = strictTestLinkEpoch(subscriptionResponse, appConfig, connectionLink);
  const metadataPending =
    validState != null && (!appConfigFetchedAfterMount || !subscriptionFetchedAfterMount);
  const strictPending =
    metadataPending ||
    (resetFence.strict &&
      (isAppConfigFetching || isSubscriptionFetching || isConnectionLinkFetching));
  const freshQrUrl = useMemo(
    () =>
      resolveConnectionUrlForUi({
        mode: connectionLink?.connect_mode,
        happSchemeLink: connectionLink?.happ_scheme_link,
        displayLink: connectionLink?.display_link,
        subscriptionUrl: connectionLink?.subscription_url,
        happCryptLink: connectionLink?.happ_cryptolink,
        happCryptoLink: connectionLink?.happ_crypto_link,
        happLink: connectionLink?.happ_link,
        fallbackUrl:
          strictPending || resetFence.strict ? null : (appConfig?.subscriptionUrl ?? null),
      }),
    [
      appConfig?.subscriptionUrl,
      connectionLink?.connect_mode,
      connectionLink?.display_link,
      connectionLink?.happ_cryptolink,
      connectionLink?.happ_crypto_link,
      connectionLink?.happ_link,
      connectionLink?.happ_scheme_link,
      connectionLink?.subscription_url,
      resetFence.strict,
      strictPending,
    ],
  );
  const stateMatchesFreshLink =
    validState != null &&
    freshQrUrl != null &&
    validState.url === freshQrUrl &&
    (!resetFence.strict || validState.testResetAt === resetFence.epoch);
  const mustLeaveQr =
    !validState ||
    (!strictPending &&
      (isAppConfigError ||
        isSubscriptionError ||
        (resetFence.strict && isConnectionLinkError) ||
        !resetFence.matches ||
        !stateMatchesFreshLink));

  useEffect(() => {
    if (mustLeaveQr) {
      navigate(connectionPath, { replace: true });
    }
  }, [mustLeaveQr, navigate, connectionPath]);

  if (!validState || strictPending || mustLeaveQr || !stateMatchesFreshLink) {
    return null;
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <AdminBackButton to={connectionPath} replace />
        <h1 className="text-2xl font-bold text-dark-100">{t('subscription.connection.qrTitle')}</h1>
      </div>

      <div className="flex flex-col items-center">
        <div className="flex w-full max-w-sm flex-col items-center px-6">
          {appName && (
            <p className="mb-3 text-sm font-medium uppercase tracking-wider text-dark-400">
              {appName}
            </p>
          )}

          <p className="mb-8 text-center text-sm text-dark-400">
            {t('subscription.connection.qrScanHint')}
          </p>

          <div className="rounded-3xl bg-white p-6">
            <QRCodeSVG
              value={freshQrUrl}
              size={280}
              level="M"
              includeMargin={false}
              className="h-[280px] w-[280px] sm:h-[360px] sm:w-[360px]"
            />
          </div>

          {!(connectionLink?.hide_link ?? appConfig?.hideLink ?? validState.hideLink) && (
            <p className="mt-6 max-w-full truncate text-center font-mono text-xs text-dark-500">
              {freshQrUrl}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
