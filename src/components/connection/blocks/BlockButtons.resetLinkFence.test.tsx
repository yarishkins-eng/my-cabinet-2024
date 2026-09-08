// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockButtons } from './BlockButtons';

const copyToClipboard = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/utils/clipboard', () => ({ copyToClipboard }));

const freshUrl = 'https://example.invalid/fresh';
const retiredResolvedUrl = 'happ://add/https%3A%2F%2Fexample.invalid%2Fretired';
const templateDeepLink = 'happ://add/{{SUBSCRIPTION_LINK}}';

const commonProps = {
  variant: 'light' as const,
  subscriptionUrl: freshUrl,
  getLocalizedText: () => 'Connect',
  getBaseTranslation: () => 'Connect',
  getSvgHtml: () => '',
  onOpenDeepLink: vi.fn(),
};

describe('BlockButtons reset-link fence', () => {
  afterEach(() => {
    cleanup();
    copyToClipboard.mockReset();
    commonProps.onOpenDeepLink.mockReset();
  });

  it('keeps a strict app-import protocol template, never a stale resolved bearer', () => {
    render(
      <BlockButtons
        {...commonProps}
        strictLink
        buttons={[
          {
            type: 'subscriptionLink',
            text: {},
            url: templateDeepLink,
            resolvedUrl: retiredResolvedUrl,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(commonProps.onOpenDeepLink).toHaveBeenCalledWith(templateDeepLink);
    expect(commonProps.onOpenDeepLink).not.toHaveBeenCalledWith(retiredResolvedUrl);
  });

  it('prefers the freshly generated HAPP crypt deep link over a button template', () => {
    const freshCryptDeepLink = 'happ://crypt/fresh-current-payload';
    render(
      <BlockButtons
        {...commonProps}
        strictLink
        deepLink={freshCryptDeepLink}
        buttons={[
          {
            type: 'subscriptionLink',
            text: {},
            url: 'happ://add/{{HAPP_CRYPT4_LINK}}',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(commonProps.onOpenDeepLink).toHaveBeenCalledWith(freshCryptDeepLink);
  });

  it('copies the current endpoint instead of a panel-resolved cached URL in strict mode', () => {
    render(
      <BlockButtons
        {...commonProps}
        strictLink
        buttons={[{ type: 'copyButton', text: {}, resolvedUrl: retiredResolvedUrl }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(copyToClipboard).toHaveBeenCalledWith(freshUrl);
  });

  it('rejects a static panel button URL in favor of the freshly generated deep link', () => {
    const freshDeepLink = 'happ://add/{{SUBSCRIPTION_LINK}}';
    render(
      <BlockButtons
        {...commonProps}
        strictLink
        deepLink={freshDeepLink}
        buttons={[
          {
            type: 'subscriptionLink',
            text: {},
            url: 'happ://add/https%3A%2F%2Fexample.invalid%2Fretired-static',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(commonProps.onOpenDeepLink).toHaveBeenCalledWith(freshDeepLink);
  });

  it('does not trust a non-bearer template wrapped around a retired URL', () => {
    const freshDeepLink = 'happ://add/{{SUBSCRIPTION_LINK}}';
    const staleWithUsername =
      'happ://add/https%3A%2F%2Fexample.invalid%2Fretired?user={{USERNAME}}';
    render(
      <BlockButtons
        {...commonProps}
        strictLink
        deepLink={freshDeepLink}
        buttons={[{ type: 'subscriptionLink', text: {}, url: staleWithUsername }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(commonProps.onOpenDeepLink).toHaveBeenCalledWith(freshDeepLink);
  });
});
