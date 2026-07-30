// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
        connect_mode: string;
        hide_link: boolean;
        instructions: { steps: string[] };
      }
    | undefined;
  isLoading: boolean;
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => queryResult,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../utils/clipboard', () => ({ copyToClipboard }));

const STAGING_TEST_URL = 'https://teplo-staging.invalid/subscription-preview';

describe('ConnectionLinkCard', () => {
  beforeEach(() => {
    queryResult = {
      data: {
        subscription_url: STAGING_TEST_URL,
        display_link: STAGING_TEST_URL,
        happ_redirect_link: null,
        happ_scheme_link: null,
        happ_crypto_link: null,
        connect_mode: 'miniapp_custom',
        hide_link: false,
        instructions: { steps: [] },
      },
      isLoading: false,
    };
    copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    copyToClipboard.mockReset();
  });

  it('shows the staging fixture and copies its exact value on the first tap', () => {
    render(<ConnectionLinkCard subscriptionId={17} subscriptionUrl={null} visible />);

    expect(screen.getByTitle(STAGING_TEST_URL)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'home.link.copy' }));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(STAGING_TEST_URL);
    expect(screen.getByRole('button', { name: 'home.link.copied' })).toBeTruthy();
  });

  it('does not show a card when neither the endpoint nor subscription has a link', () => {
    queryResult = { data: undefined, isLoading: false };

    const { container } = render(
      <ConnectionLinkCard subscriptionId={17} subscriptionUrl={null} visible />,
    );

    expect(container.innerHTML).toBe('');
  });
});
