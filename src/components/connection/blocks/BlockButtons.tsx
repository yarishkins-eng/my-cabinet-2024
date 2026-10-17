import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon } from '@/components/icons';
import type { RemnawaveButtonClient, LocalizedText } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { blockButtonClass } from './buttonStyles';
import { resolveTemplate } from '@/utils/templateEngine';

// eslint-disable-next-line no-script-url
const dangerousSchemes = ['javascript:', 'data:', 'vbscript:', 'file:'];
const bearerTemplate = /\{\{(?:SUBSCRIPTION_LINK|HAPP_CRYPT[34]_LINK)\}\}/;

function isValidDeepLink(url: string | null | undefined): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase().trim();
  if (dangerousSchemes.some((s) => lowerUrl.startsWith(s))) return false;
  return lowerUrl.includes('://');
}

function isValidExternalUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase().trim();
  if (dangerousSchemes.some((s) => lowerUrl.startsWith(s))) return false;
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://');
}

interface BlockButtonsProps {
  step?: { primary: boolean; action: (type: string) => void };
  appName?: string;
  buttons: RemnawaveButtonClient[] | undefined;
  variant: 'light' | 'subtle';
  subscriptionUrl: string | null;
  /** Reset-history accounts may not reuse panel-resolved cached bearer URLs. */
  strictLink?: boolean;
  hideLink?: boolean;
  deepLink?: string | null;
  getLocalizedText: (text: LocalizedText | undefined) => string;
  getBaseTranslation: (key: string, i18nKey: string) => string;
  getSvgHtml: (key: string | undefined) => string;
  onOpenDeepLink: (url: string) => void;
}

export function BlockButtons({
  buttons,
  variant,
  subscriptionUrl,
  strictLink,
  hideLink,
  deepLink,
  getLocalizedText,
  getBaseTranslation,
  getSvgHtml,
  onOpenDeepLink,
  step,
  appName,
}: BlockButtonsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = useCallback(async (url: string) => {
    setCopyError(false);
    setCopied(false);
    clearTimeout(copyTimer.current);
    try {
      await copyToClipboard(url);
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }, []);

  if (!buttons || buttons.length === 0) return null;

  const baseClass = blockButtonClass(variant);
  const mainClass = step
    ? `${step.primary ? 'btn-primary' : baseClass} min-h-11 w-full justify-center`
    : baseClass;
  const smallClass = step
    ? 'min-h-11 w-full justify-center text-center text-xs text-accent-400'
    : baseClass;

  return (
    <div className={step ? 'mt-2 flex flex-wrap gap-0.5' : 'mt-3 flex flex-wrap gap-2'}>
      {buttons.map((btn, idx) => {
        const btnText = getLocalizedText(btn.text);
        const btnSvg = getSvgHtml(btn.svgIconKey);
        const btnIcon = btnSvg ? (
          <div
            className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: btnSvg }}
          />
        ) : null;

        if (btn.type === 'subscriptionLink') {
          const strictTemplate = [btn.url, btn.link].find((candidate): candidate is string =>
            Boolean(candidate && bearerTemplate.test(candidate)),
          );
          const url = strictLink
            ? deepLink || strictTemplate || subscriptionUrl
            : btn.resolvedUrl || btn.url || btn.link || deepLink || subscriptionUrl;
          const resolved =
            url && subscriptionUrl && bearerTemplate.test(url)
              ? resolveTemplate(url, { subscriptionUrl })
              : url;
          if (!url || !isValidDeepLink(resolved) || (resolved && /\{\{/.test(resolved)))
            return null;
          return (
            <button
              key={idx}
              onClick={() => {
                step?.action('subscriptionLink');
                onOpenDeepLink(url);
              }}
              className={`flex items-center gap-2 ${mainClass}`}
            >
              {btnIcon}
              {btnText || getBaseTranslation('openApp', 'subscription.connection.openLink')}
            </button>
          );
        }

        if (btn.type === 'copyButton') {
          if (hideLink) return null;
          const url = strictLink || step ? subscriptionUrl : btn.resolvedUrl || subscriptionUrl;
          if (!url) return null;
          return (
            <button
              key={idx}
              onClick={() => handleCopy(url)}
              className={`flex items-center gap-2 ${
                copied
                  ? `rounded-xl border border-success-500 bg-success-500/10 px-4 py-2 text-sm font-medium text-success-400 ${step ? 'min-h-11 w-full justify-center' : ''}`
                  : smallClass
              }`}
            >
              {copied ? <CheckIcon /> : btnIcon || <CopyIcon />}
              {copied
                ? t(
                    step
                      ? 'subscription.connection.settingsCopied'
                      : 'subscription.connection.copied',
                  )
                : step
                  ? t('subscription.connection.copyConnectionLink')
                  : btnText || getBaseTranslation('copyLink', 'subscription.connection.copyLink')}
            </button>
          );
        }

        // external
        const href = btn.link || btn.url || '';
        if (!isValidExternalUrl(href)) return null;
        return (
          <a
            key={idx}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => step?.action('external')}
            className={`inline-flex items-center gap-2 ${idx === 0 && !(appName === 'Happ' && href.includes('apple.com')) ? mainClass : smallClass}`}
          >
            {btnIcon}
            {btnText}
          </a>
        );
      })}
      {copyError && (
        <p role="alert" className="text-sm text-error-400">
          {t('subscription.connection.copyFailed', { app: appName || '' })}
        </p>
      )}
    </div>
  );
}
