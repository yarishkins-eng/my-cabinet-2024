// @vitest-environment jsdom

// 🔴 РЕК-3. Сторож на находку скептика: глобальный обработчик пополнения гасил три ключа и
// НЕ гасил тот, из которого касса берёт баланс. Канал живой: человек стоит на подтверждении,
// копирует платёжную ссылку, платит из браузера и возвращается «назад» — мимо экрана
// результата пополнения, где стоит вся остальная защита этапа. Без этого ключа касса держит
// дооплатное «Не хватает N ₽» и залитую кнопку «Доплатить N ₽» бессрочно.
// ⛔ Проверяем ИСХОД (запрос помечен протухшим), а не факт вызова: перебирать в тесте тот же
// список ключей, что и в коде, значит доказывать сам себя.

import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import WebSocketNotifications from './WebSocketNotifications';
import type { WSMessage } from '../hooks/useWebSocket';

const { deliver } = vi.hoisted(() => ({
  deliver: { current: null as ((message: WSMessage) => void) | null },
}));
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: ({ onMessage }: { onMessage: (message: WSMessage) => void }) => {
    deliver.current = onMessage;
    return { isConnected: true };
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('./Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser: vi.fn() }),
}));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (v: number) => String(v), currencySymbol: '₽' }),
}));
vi.mock('../store/successNotification', () => ({
  useSuccessNotification: (selector: (state: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() }),
}));

describe('РЕК-3 · пополнение мимо экрана результата не оставляет кассу со старым балансом', () => {
  afterEach(() => cleanup());

  it('пополнение по вебсокету помечает баланс кассы протухшим', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // Касса уже прочитала ДОоплатный баланс и ушла с экрана — наблюдателя нет.
    queryClient.setQueryData(['device-first-options'], { eligible: true, balance_kopeks: 5000 });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WebSocketNotifications />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(queryClient.getQueryState(['device-first-options'])?.isInvalidated).toBe(false);

    deliver.current?.({
      type: 'balance.topup',
      amount_kopeks: 19900,
      new_balance_kopeks: 24900,
    } as WSMessage);

    expect(queryClient.getQueryState(['device-first-options'])?.isInvalidated).toBe(true);
  });
});
