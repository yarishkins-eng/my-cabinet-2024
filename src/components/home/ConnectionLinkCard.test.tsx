// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionLinkCard from './ConnectionLinkCard';

const copyToClipboard = vi.hoisted(() => vi.fn());

let queryResult: {
  data:
    | {
        subscription_url: string | null;
        display_link: string | null;
        happ_redirect_link: string | null;
        happ_scheme_link: string | null;
        happ_crypto_link: string | null;
        test_reset_at?: string | null;
        connect_mode: string;
        hide_link: boolean;
        instructions: { steps: string[] };
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryResult,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../utils/clipboard', () => ({ copyToClipboard }));

const TEST_CONNECTION_URL = 'https://example.com/subscription';

describe('ConnectionLinkCard', () => {
  beforeEach(() => {
    queryResult = {
      data: {
        subscription_url: TEST_CONNECTION_URL,
        display_link: TEST_CONNECTION_URL,
        happ_redirect_link: null,
        happ_scheme_link: null,
        happ_crypto_link: null,
        connect_mode: 'miniapp_custom',
        hide_link: false,
        instructions: { steps: [] },
      },
      isLoading: false,
      isError: false,
    };
    copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    copyToClipboard.mockReset();
  });

  it('confirms the exact connection URL after a successful copy', async () => {
    render(<ConnectionLinkCard subscriptionId={17} subscriptionUrl={null} visible />);

    expect(screen.getByTitle(TEST_CONNECTION_URL)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'home.link.copy' }));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(TEST_CONNECTION_URL);
    const copiedButton = await screen.findByRole('button', { name: 'home.link.copied' });
    expect(copiedButton.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['bg-success-500/10', 'text-success-800', 'dark:text-success-200']),
    );
  });

  it('uses the fresh endpoint URL after a test reset, never the cached fallback', async () => {
    const freshUrl = 'https://example.com/fresh-test-subscription';
    queryResult.data = {
      ...queryResult.data!,
      subscription_url: freshUrl,
      display_link: freshUrl,
      test_reset_at: '2026-09-08T12:00:00+00:00',
    };

    render(
      <ConnectionLinkCard
        subscriptionId={18}
        subscriptionUrl="https://example.com/retired"
        visible
      />,
    );

    expect(screen.getByText('admin.users.testReset.clientCleanup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'home.link.copy' }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(freshUrl));
    expect(copyToClipboard).not.toHaveBeenCalledWith('https://example.com/retired');
  });

  it('shows a selectable manual fresh link when clipboard copy fails after a reset', async () => {
    queryResult.data = {
      ...queryResult.data!,
      test_reset_at: '2026-09-08T12:00:00+00:00',
    };
    copyToClipboard.mockRejectedValueOnce(new Error('clipboard unavailable'));

    render(<ConnectionLinkCard subscriptionId={17} subscriptionUrl={null} visible />);

    fireEvent.click(screen.getByRole('button', { name: 'home.link.copy' }));

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'home.link.copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'home.link.copied' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('admin.users.testReset.copyError');
    expect(screen.getByTitle(TEST_CONNECTION_URL).className).toContain('select-all');
  });

  it('does not expose a retired cached URL when strict fresh-link loading fails before a response', () => {
    queryResult = { data: undefined, isLoading: false, isError: true };
    const retiredUrl = 'https://example.com/retired-no-response';

    render(
      <ConnectionLinkCard
        subscriptionId={17}
        subscriptionUrl={retiredUrl}
        visible
        requireFreshLink
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('admin.users.testReset.linkLoadError');
    expect(screen.queryByTitle(retiredUrl)).toBeNull();
    expect(screen.queryByRole('button', { name: 'home.link.copy' })).toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('does not expose stale endpoint data when strict fresh-link refresh reports an error', () => {
    const retiredUrl = 'https://example.com/retired-stale-response';
    queryResult = {
      data: {
        ...queryResult.data!,
        subscription_url: retiredUrl,
        display_link: retiredUrl,
      },
      isLoading: false,
      isError: true,
    };

    render(
      <ConnectionLinkCard
        subscriptionId={17}
        subscriptionUrl={retiredUrl}
        visible
        requireFreshLink
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('admin.users.testReset.linkLoadError');
    expect(screen.queryByTitle(retiredUrl)).toBeNull();
    expect(screen.queryByRole('button', { name: 'home.link.copy' })).toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('keeps the ordinary cached fallback when the endpoint is unavailable and fresh-link mode is off', () => {
    queryResult = { data: undefined, isLoading: false, isError: true };
    const fallbackUrl = 'https://example.com/ordinary-fallback';

    render(
      <ConnectionLinkCard
        subscriptionId={17}
        subscriptionUrl={fallbackUrl}
        visible
        requireFreshLink={false}
      />,
    );

    expect(screen.getByTitle(fallbackUrl)).toBeTruthy();
    expect(screen.queryByText('admin.users.testReset.clientCleanup')).toBeNull();
  });

  it('does not show a card when neither the endpoint nor subscription has a link', () => {
    queryResult = { data: undefined, isLoading: false, isError: false };

    const { container } = render(
      <ConnectionLinkCard subscriptionId={17} subscriptionUrl={null} visible />,
    );

    expect(container.innerHTML).toBe('');
  });
});
