import { useEffect, useRef, useState } from 'react';
import { subscriptionApi } from '@/api/subscription';

export interface ConnectionFlow {
  platform: string;
  app: string;
  scope: string;
  subscriptionId?: number;
  selectIncy: () => void;
}
type Device = {
  hwid: string;
  platform?: string | null;
  app?: string | null;
  created_at?: string | null;
};
interface Progress {
  installed?: boolean;
  store?: boolean;
  importing?: boolean;
  importingAt?: number;
  tapSnapshot?: Device[];
  received?: boolean;
  working?: boolean;
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
  const latest = useRef<Device[] | undefined>(undefined);
  const attempt = useRef(0);
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
  const waiting = () => {
    const age = Date.now() - (current.current.importingAt ?? NaN);
    const valid = Number.isFinite(current.current.importingAt) && age >= 0 && age <= 900000;
    if (current.current.importing && !valid) update({ importing: false });
    return current.current.importing && valid;
  };
  useEffect(() => {
    if (!flow) return;
    let live = true;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let reading = false;
    const read = async () => {
      const traffic = current.current.received && !current.current.working;
      if (reading) return;
      reading = true;
      const importing = waiting();
      const startedAttempt = attempt.current;
      try {
        const result = await (traffic
          ? subscriptionApi.getDevices(flow.subscriptionId, true)
          : subscriptionApi.getDevices(flow.subscriptionId));
        if (!live) return;
        const active = waiting();
        if (result.panel_ok === false) return;
        if (current.current.received && result.vpn_working === true && result.total === 1) {
          update({ working: true });
          timers.forEach(clearTimeout);
          timers = [];
        }
        latest.current = result.devices.map(({ hwid, platform, app, created_at }) => ({
          hwid,
          platform,
          app,
          created_at,
        }));
        const baseline = current.current.baseline;
        const snapshot = { hwids: result.devices.map((d) => d.hwid), total: result.total };
        if (!active || !importing || startedAttempt !== attempt.current) {
          update({ baseline: snapshot, ...(active ? { tapSnapshot: latest.current } : {}) });
          return;
        }
        const matches = (d: Device, legacy = false) =>
          (d.platform ? d.platform.toLowerCase() === flow.platform.toLowerCase() : legacy) &&
          (d.app ? d.app.toLowerCase() === flow.app.toLowerCase() : legacy);
        const added = baseline
          ? result.devices.filter((d) => !baseline.hwids?.includes(d.hwid))
          : [];
        const newDevice =
          !!baseline &&
          (added.length ? added.some((d) => matches(d, true)) : result.total > baseline.total);
        const tap = current.current.tapSnapshot;
        const before = Array.isArray(tap) ? tap.filter((d) => matches(d)) : [];
        const after = result.devices.filter((d) => matches(d));
        const previousTime = Date.parse(before[0]?.created_at || '');
        const nextTime = Date.parse(after[0]?.created_at || '');
        const repeated =
          before.length === 1 &&
          after.length === 1 &&
          !!before[0].hwid &&
          before[0].hwid === after[0].hwid &&
          Number.isFinite(previousTime) &&
          Number.isFinite(nextTime) &&
          nextTime > previousTime;
        if (!baseline) update({ baseline: snapshot });
        if (newDevice || repeated) update({ received: true, installed: true, importing: false });
      } catch {
        /* A failed panel read cannot prove that settings were received. */
      } finally {
        reading = false;
      }
    };
    const returned = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (document.visibilityState !== 'visible') return;
      if (current.current.store) update({ installed: true, store: false });
      if (waiting() || (current.current.received && !current.current.working))
        timers = [0, 5000, 15000, 45000, 90000, 180000].map((ms) => setTimeout(read, ms));
      else void read();
    };
    if (!current.current.received || current.current.working) void read();
    if (current.current.importing || (current.current.received && !current.current.working))
      returned();
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
  const active = progress.working ? 3 : progress.received ? 2 : installed ? 1 : 0;
  return {
    active,
    received: progress.received,
    expanded,
    setExpanded,
    action: (type: string) => {
      if (type === 'external') update({ store: true });
      else {
        attempt.current += 1;
        update({ importing: true, importingAt: Date.now(), tapSnapshot: latest.current });
      }
    },
    skip: () => update({ installed: true }),
  };
}
