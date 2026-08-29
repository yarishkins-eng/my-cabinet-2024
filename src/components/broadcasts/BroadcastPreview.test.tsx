// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { TelegramPreview } from './BroadcastPreview';

afterEach(cleanup);

describe('РС-13: Telegram preview contract', () => {
  it('декодирует canonical entities и отображает поддержанный blockquote', () => {
    render(
      <TelegramPreview
        open
        onClose={() => undefined}
        text={
          '5 &amp; 10<blockquote>цитата</blockquote><a href="https://example.com/?a=1&amp;b=2">ссылка</a>'
        }
      />,
    );

    expect(screen.getByText(/5 & 10/)).toBeTruthy();
    expect(screen.queryByText(/&amp;/)).toBeNull();
    expect(screen.getByText('цитата').closest('blockquote')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toContain('?a=1&b=2');
  });

  it('рисует документ и длинный текст двумя сообщениями без blob preview', () => {
    render(
      <TelegramPreview
        open
        onClose={() => undefined}
        text="длинный текст"
        mediaType="document"
        mediaName="offer.pdf"
        separateMediaText
      />,
    );

    expect(screen.getByText(/offer.pdf/)).toBeTruthy();
    expect(screen.getByText('длинный текст')).toBeTruthy();
    expect(screen.getByText(/offer.pdf/).closest('.rounded-2xl')).not.toBe(
      screen.getByText('длинный текст').closest('.rounded-2xl'),
    );
  });
});
