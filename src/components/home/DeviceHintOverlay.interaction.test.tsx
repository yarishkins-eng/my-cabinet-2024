// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import DeviceHintOverlay from './DeviceHintOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const targetRect = {
  x: 16,
  y: 100,
  top: 100,
  left: 16,
  right: 344,
  bottom: 172,
  width: 328,
  height: 72,
  toJSON: () => ({}),
} as DOMRect;

const offscreenTargetRect = {
  ...targetRect,
  y: -1,
  top: -1,
  bottom: 71,
} as DOMRect;

function HintFixture({
  onDismiss = vi.fn(),
  onConnect = vi.fn(),
  onOtherAction = vi.fn(),
  onTargetUnavailable = vi.fn(),
  unmountOnDismiss = false,
  unmountOnConnect = false,
  unmountOnTargetUnavailable = false,
  target = targetRect,
}: {
  onDismiss?: () => void;
  onConnect?: () => void;
  onOtherAction?: () => void;
  onTargetUnavailable?: () => void;
  unmountOnDismiss?: boolean;
  unmountOnConnect?: boolean;
  unmountOnTargetUnavailable?: boolean;
  target?: DOMRect;
}) {
  const [visible, setVisible] = useState(true);
  const targetRef = useRef<HTMLButtonElement>(null);

  const setTargetRef = (node: HTMLButtonElement | null) => {
    targetRef.current = node;
    if (!node) return;
    node.getBoundingClientRect = () => target;
    node.getClientRects = () => [target] as unknown as DOMRectList;
    node.scrollIntoView = vi.fn();
    node.focus = vi.fn();
  };

  const dismiss = () => {
    onDismiss();
    if (unmountOnDismiss) setVisible(false);
  };

  const connect = () => {
    if (unmountOnConnect) setVisible(false);
    onConnect();
  };

  const targetUnavailable = () => {
    onTargetUnavailable();
    if (unmountOnTargetUnavailable) setVisible(false);
  };

  return (
    <>
      <button ref={setTargetRef} type="button" onClick={connect}>
        Connect device
      </button>
      <button type="button" onClick={onOtherAction}>
        Copy link
      </button>
      {visible && (
        <DeviceHintOverlay
          targetRef={targetRef}
          onDismiss={dismiss}
          onTargetUnavailable={targetUnavailable}
        />
      )}
    </>
  );
}

describe('DeviceHintOverlay interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('dismisses from its accessible close button', async () => {
    const onDismiss = vi.fn();
    render(<HintFixture onDismiss={onDismiss} />);

    const close = await screen.findByRole('button', { name: 'common.close' });
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');
    fireEvent.click(close);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape, but not at the start of a scroll gesture', async () => {
    const onDismiss = vi.fn();
    render(<HintFixture onDismiss={onDismiss} />);
    await screen.findByRole('button', { name: 'common.close' });

    fireEvent.pointerDown(document.body);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses from a click on a blank area', async () => {
    const onDismiss = vi.fn();
    render(<HintFixture onDismiss={onDismiss} />);
    await screen.findByRole('button', { name: 'common.close' });

    await waitFor(() => {
      fireEvent.click(document.body);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('dismisses on an outside click while preserving the first click on another action', async () => {
    const onDismiss = vi.fn();
    const onOtherAction = vi.fn();
    render(<HintFixture onDismiss={onDismiss} onOtherAction={onOtherAction} unmountOnDismiss />);
    await screen.findByRole('button', { name: 'common.close' });

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onOtherAction).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    });
  });

  it('leaves the real Connect CTA to its own action', async () => {
    const onDismiss = vi.fn();
    const onConnect = vi.fn();
    render(<HintFixture onDismiss={onDismiss} onConnect={onConnect} unmountOnConnect />);
    await screen.findByRole('button', { name: 'common.close' });

    fireEvent.click(screen.getByRole('button', { name: 'Connect device' }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
  });

  it('does not force focus or scroll on the CTA', async () => {
    render(<HintFixture />);
    await screen.findByRole('button', { name: 'common.close' });

    const target = screen.getByRole('button', { name: 'Connect device' });
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    expect(target.focus).not.toHaveBeenCalled();
  });

  it('hides instead of scrolling when the CTA is outside the viewport', async () => {
    const onTargetUnavailable = vi.fn();
    render(
      <HintFixture
        onTargetUnavailable={onTargetUnavailable}
        target={offscreenTargetRect}
        unmountOnTargetUnavailable
      />,
    );

    await waitFor(() => {
      expect(onTargetUnavailable).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    });

    expect(
      screen.getByRole('button', { name: 'Connect device' }).scrollIntoView,
    ).not.toHaveBeenCalled();
  });
});
