import { useEffect, useRef, useState } from 'react';
import { subscriptionApi } from '@/api/subscription';

export interface ConnectionFlow {
  platform: string;
  app: string;
  scope: string;
  subscriptionId?: number;
  selectIncy: () => void;
}
interface Progress {
  installed?: boolean;
  store?: boolean;
  importing?: boolean;
  received?: boolean;
  baseline?: { hwids: string[]; total: number };
}

export function useConnectionProgress(flow?: ConnectionFlow) {
  const key = flow ? `connection:${flow.scope}:${flow.platform}:${flow.app}` : '';
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      return { ...saved, installed: saved.installed || saved.store };
    } catch {
      return {};
    }
  });
  const current = useRef(progress);
  const [expanded, setExpanded] = useState<number | null>(null);
  const update = (patch: Partial<Progress>) => {
    current.current = { ...current.current, ...patch };
    setProgress(current.current);
    try {
      localStorage.setItem(key, JSON.stringify(current.current));
    } catch {
      /* WebView storage may be blocked. */
    }
  };
  useEffect(() => {
    if (!flow) return;
    let live = true;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const read = async () => {
      try {
        const result = await subscriptionApi.getDevices(flow.subscriptionId);
        if (!live || result.panel_ok === false) return;
        const baseline = current.current.baseline;
        const snapshot = { hwids: result.devices.map((d) => d.hwid), total: result.total };
        if (!baseline) update({ baseline: snapshot });
        else if (
          current.current.importing &&
          (result.total > baseline.total ||
            snapshot.hwids.some((id) => !baseline.hwids.includes(id)))
        ) {
          update({ received: true, installed: true, importing: false });
        }
      } catch {
        /* A failed panel read cannot prove that settings were received. */
      }
    };
    const returned = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (document.visibilityState !== 'visible') return;
      if (current.current.store) update({ installed: true, store: false });
      if (current.current.importing) timers = [0, 5000, 15000].map((ms) => setTimeout(read, ms));
    };
    void read();
    if (current.current.importing) returned();
    document.addEventListener('visibilitychange', returned);
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      document.removeEventListener('visibilitychange', returned);
    };
    // The renderer is keyed by scope/platform/app; each mount owns its snapshot and timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const installed = progress.installed || (flow?.platform === 'ios' && flow.app === 'Happ');
  const active = progress.received ? 2 : installed ? 1 : 0;
  return {
    active,
    received: progress.received,
    expanded,
    setExpanded,
    action: (type: string) => update(type === 'external' ? { store: true } : { importing: true }),
    skip: () => update({ installed: true }),
  };
}
