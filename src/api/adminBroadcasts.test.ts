import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminBroadcastsApi } from './adminBroadcasts';
import apiClient from './client';

vi.mock('./client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

describe('РС-9: category-aware broadcast preview API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: {} });
    postMock.mockResolvedValue({ data: { target: 'all', count: 1 } });
  });

  it('передаёт категорию в оба каталога фильтров', async () => {
    await adminBroadcastsApi.getFilters('news');
    await adminBroadcastsApi.getEmailFilters('promo');

    expect(getMock.mock.calls[0]).toEqual([
      '/cabinet/admin/broadcasts/filters',
      { params: { category: 'news' } },
    ]);
    expect(getMock.mock.calls[1]).toEqual([
      '/cabinet/admin/broadcasts/email-filters',
      { params: { category: 'promo' } },
    ]);
  });

  it('не теряет category в Telegram и Email preview payload', async () => {
    await adminBroadcastsApi.preview({ target: 'all', category: 'news' });
    await adminBroadcastsApi.previewEmail({ target: 'all_email', category: 'promo' });

    expect(postMock.mock.calls[0]).toEqual([
      '/cabinet/admin/broadcasts/preview',
      { target: 'all', category: 'news' },
    ]);
    expect(postMock.mock.calls[1]).toEqual([
      '/cabinet/admin/broadcasts/email-preview',
      { target: 'all_email', category: 'promo' },
    ]);
  });

  it.each(['news', 'promo'] as const)(
    'передаёт create payload без подмены category=%s',
    async (category) => {
      postMock.mockResolvedValueOnce({ data: { id: 17, status: 'queued' } });
      const payload = {
        channel: 'telegram' as const,
        target: 'active',
        category,
        message_text: 'Новость',
        selected_buttons: [],
      };

      await adminBroadcastsApi.createCombined(payload);

      expect(postMock.mock.calls[0]).toEqual(['/cabinet/admin/broadcasts/send', payload]);
    },
  );
});
