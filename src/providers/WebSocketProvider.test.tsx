// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketProvider } from './WebSocketProvider';
import { LIVE_STATE_QUERY_KEYS } from './liveStateRefresh';

const { authState } = vi.hoisted(() => ({
  authState: { accessToken: 'test-token', isAuthenticated: true },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: <T,>(selector: (state: typeof authState) => T): T => selector(authState),
}));

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' } as CloseEvent);
  }

  send() {}
}

function renderProvider(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <WebSocketProvider>
        <div>child</div>
      </WebSocketProvider>
    </QueryClientProvider>,
  );
}

describe('WebSocketProvider state reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refetches live state after a real WebSocket reconnect, but not at first connect', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderProvider(client);

    MockWebSocket.instances[0].open();
    expect(invalidate).not.toHaveBeenCalled();

    MockWebSocket.instances[0].close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    MockWebSocket.instances[1].open();

    expect(invalidate.mock.calls.map(([filters]) => filters.queryKey)).toEqual(
      LIVE_STATE_QUERY_KEYS.map((queryKey) => [...queryKey]),
    );
  });

  it('refetches live state when a signed-in tab returns to the foreground', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderProvider(client);

    MockWebSocket.instances[0].open();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(invalidate.mock.calls.map(([filters]) => filters.queryKey)).toEqual(
      LIVE_STATE_QUERY_KEYS.map((queryKey) => [...queryKey]),
    );
  });

  it('does not replace a socket that is still connecting when the tab becomes visible', () => {
    const client = new QueryClient();
    renderProvider(client);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
