import { describe, it, expect } from 'vitest';
import { computeScreenState, type ScreenStateInput, type SubscriptionLike } from './screenState';

/**
 * Spec source of truth: ПЛАН-объединение-Главная-Подписка.md
 *   — §4 (three levels), §6 (traffic), §7 (state table T1–T5 / P1–P9),
 *     §16 (final visual), §19 (root + rules).
 *
 * computeScreenState is a PURE function: data in → decision out. No React,
 * no time, no I/O. The visual layer (chat 3) only renders the result.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────

/** A healthy paid, active subscription with plenty of time left. */
function makeSub(over: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    id: 1,
    status: 'active',
    is_trial: false,
    is_active: true,
    is_expired: false,
    is_limited: false,
    days_left: 30,
    hours_left: 0,
    traffic_limit_gb: 100,
    traffic_used_gb: 10,
    traffic_used_percent: 10,
    device_limit: 3,
    subscription_url: 'https://sub.example/abc',
    hide_subscription_link: false,
    is_daily: false,
    ...over,
  };
}

function run(sub: SubscriptionLike | null, input: Partial<ScreenStateInput> = {}) {
  return computeScreenState({ subscription: sub, connectedDevices: 0, ...input });
}

// ── Level 0 / no subscription ───────────────────────────────────────────────

describe('level 0 / edge inputs', () => {
  it('blocked → level 0, everything hidden', () => {
    const s = run(makeSub(), { blocked: true });
    expect(s.level).toBe(0);
    expect(s.overlay).toBeNull();
    expect(s.code).toBeNull();
    expect(s.deviceZone.kind).toBe('hidden');
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(false);
  });

  it('no subscription → neutral hidden state, no crash', () => {
    const s = run(null);
    expect(s.code).toBeNull();
    expect(s.deviceZone.kind).toBe('hidden');
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(false);
  });
});

// ── Level 1 overlays ─────────────────────────────────────────────────────────

describe('level 1 — overlapping states (priority)', () => {
  it('pending → payment_pending overlay, no buttons, link hidden', () => {
    const s = run(makeSub({ status: 'pending', is_active: false }), { connectedDevices: 1 });
    expect(s.level).toBe(1);
    expect(s.overlay).toBe('payment_pending');
    expect(s.burning).toBe('none');
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.deviceZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(false);
  });

  it('disabled → disabled overlay, purchases hidden, link hidden', () => {
    const s = run(makeSub({ status: 'disabled' }), { connectedDevices: 1 });
    expect(s.level).toBe(1);
    expect(s.overlay).toBe('disabled');
    expect(s.burning).toBe('none');
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(false);
  });

  it('pending takes priority over disabled', () => {
    const s = run(makeSub({ status: 'pending', is_active: false }));
    expect(s.overlay).toBe('payment_pending');
  });
});

// ── purchases restricted (admin) — hides only paid actions ───────────────────

describe('purchases restricted flag', () => {
  it('hides the sell button but keeps the rest of the screen (P5 → no renew)', () => {
    const s = run(makeSub({ days_left: 2 }), { connectedDevices: 1, purchasesRestricted: true });
    expect(s.level).toBe(2);
    expect(s.purchasesRestricted).toBe(true);
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.burning).not.toBe('sell');
    expect(s.linkVisible).toBe(true);
  });

  it('demotes paid device top-up but keeps free connect', () => {
    // P3 would normally burn add_device; restricted hides it.
    const s = run(makeSub(), {
      connectedDevices: 3,
      canTopupDevice: true,
      purchasesRestricted: true,
    });
    expect(s.deviceZone.kind).not.toBe('add_device');
    expect(s.burning).not.toBe('add_device');
  });
});

// ── Trial states T1–T5 ───────────────────────────────────────────────────────

describe('trial states', () => {
  const trial = (over: Partial<SubscriptionLike> = {}) =>
    makeSub({
      is_trial: true,
      traffic_limit_gb: 10,
      traffic_used_gb: 2,
      traffic_used_percent: 20,
      device_limit: 5,
      days_left: 3,
      hours_left: 5,
      ...over,
    });

  it('T1 — trial, 0 devices → connect burns, no sell', () => {
    const s = run(trial({ traffic_used_gb: 0, traffic_used_percent: 0 }), { connectedDevices: 0 });
    expect(s.code).toBe('T1');
    expect(s.burning).toBe('connect');
    expect(s.deviceZone.kind).toBe('connect');
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(true);
    expect(s.accessEnded).toBe(false);
  });

  it('T2 — trial, free slot → subscribe burns, connect-more calm', () => {
    const s = run(trial(), { connectedDevices: 2 });
    expect(s.code).toBe('T2');
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('subscribe');
    expect(s.deviceZone.kind).toBe('connect_more');
  });

  it('T3 — trial, device limit reached → subscribe burns, red trial-limit label', () => {
    const s = run(trial({ device_limit: 2 }), { connectedDevices: 2 });
    expect(s.code).toBe('T3');
    expect(s.burning).toBe('sell');
    expect(s.deviceZone.kind).toBe('trial_limit');
  });

  it('T4 — trial, traffic out → subscribe burns, trafficExhausted, devices still shown', () => {
    const s = run(trial({ is_limited: true, traffic_used_gb: 10, traffic_used_percent: 100 }), {
      connectedDevices: 2,
    });
    expect(s.code).toBe('T4');
    expect(s.burning).toBe('sell');
    expect(s.trafficExhausted).toBe(true);
    expect(s.deviceZone.kind).toBe('connect_more');
    expect(s.linkVisible).toBe(true);
  });

  it('T5 — trial expired by date → subscribe burns, access ended, link & devices hidden', () => {
    const s = run(trial({ is_expired: true, status: 'expired', days_left: 0 }), {
      connectedDevices: 2,
    });
    expect(s.code).toBe('T5');
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('subscribe');
    expect(s.accessEnded).toBe(true);
    expect(s.linkVisible).toBe(false);
    expect(s.deviceZone.kind).toBe('hidden');
  });
});

// ── Paid states P1–P9 ────────────────────────────────────────────────────────

describe('paid states', () => {
  it('P1 — paid, 0 devices, lots of time → connect burns, no sell', () => {
    const s = run(makeSub(), { connectedDevices: 0 });
    expect(s.code).toBe('P1');
    expect(s.burning).toBe('connect');
    expect(s.deviceZone.kind).toBe('connect');
    expect(s.sellZone.kind).toBe('hidden');
  });

  it('P2 — paid, free slot, lots of time → nothing burns, connect-more calm', () => {
    const s = run(makeSub(), { connectedDevices: 1 });
    expect(s.code).toBe('P2');
    expect(s.burning).toBe('none');
    expect(s.deviceZone.kind).toBe('connect_more');
    expect(s.sellZone.kind).toBe('hidden');
  });

  it('P3 — paid, device limit, top-up ON → add_device burns', () => {
    const s = run(makeSub(), { connectedDevices: 3, canTopupDevice: true });
    expect(s.code).toBe('P3');
    expect(s.burning).toBe('add_device');
    expect(s.deviceZone.kind).toBe('add_device');
  });

  it('P4 — paid, device limit, top-up OFF → just the counter, nothing burns', () => {
    const s = run(makeSub(), { connectedDevices: 3, canTopupDevice: false });
    expect(s.code).toBe('P4');
    expect(s.burning).toBe('none');
    expect(s.deviceZone.kind).toBe('limit_counter');
  });

  it('P5 — paid, ≤3 days, free slot → renew burns, connect-more calm', () => {
    const s = run(makeSub({ days_left: 2 }), { connectedDevices: 1 });
    expect(s.code).toBe('P5');
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('renew');
    expect(s.deviceZone.kind).toBe('connect_more');
  });

  it('P6 — paid, ≤3 days, device limit → renew burns, device top-up hidden', () => {
    const s = run(makeSub({ days_left: 2 }), { connectedDevices: 3, canTopupDevice: true });
    expect(s.code).toBe('P6');
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('renew');
    expect(s.deviceZone.kind).toBe('limit_counter');
  });

  it('P7 — paid, ≤3 days, 0 devices → connect burns, renew calm', () => {
    const s = run(makeSub({ days_left: 2 }), { connectedDevices: 0 });
    expect(s.code).toBe('P7');
    expect(s.burning).toBe('connect');
    expect(s.deviceZone.kind).toBe('connect');
    expect(s.sellZone.kind).toBe('renew');
  });

  it('P8 — paid expired by date → renew burns, access ended, link & devices hidden', () => {
    const s = run(makeSub({ is_expired: true, status: 'expired', days_left: 0 }), {
      connectedDevices: 2,
    });
    expect(s.code).toBe('P8');
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('renew');
    expect(s.accessEnded).toBe(true);
    expect(s.linkVisible).toBe(false);
    expect(s.deviceZone.kind).toBe('hidden');
  });

  it('P9 — paid, traffic out, days remain → nothing burns, traffic info, link visible', () => {
    const s = run(
      makeSub({ is_limited: true, traffic_used_gb: 100, traffic_used_percent: 100, days_left: 20 }),
      { connectedDevices: 2, canTopupTraffic: true },
    );
    expect(s.code).toBe('P9');
    expect(s.burning).toBe('none');
    expect(s.trafficExhausted).toBe(true);
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.linkVisible).toBe(true);
    expect(s.canTopupTraffic).toBe(true);
  });
});

// ── Critical rule: "date beats status" (§4) ──────────────────────────────────

describe('rule: date beats status', () => {
  it('limited status + expired date → P8 (ended), NOT P9', () => {
    const s = run(
      makeSub({
        status: 'limited',
        is_limited: true,
        is_expired: true,
        days_left: 0,
        traffic_used_gb: 100,
        traffic_used_percent: 100,
      }),
      { connectedDevices: 2 },
    );
    expect(s.code).toBe('P8');
    expect(s.accessEnded).toBe(true);
    expect(s.linkVisible).toBe(false);
  });

  it('trial: limited status + expired date → T5 (ended), NOT T4', () => {
    const s = run(
      makeSub({
        is_trial: true,
        status: 'limited',
        is_limited: true,
        is_expired: true,
        days_left: 0,
        traffic_limit_gb: 10,
        traffic_used_gb: 10,
        traffic_used_percent: 100,
      }),
      { connectedDevices: 2 },
    );
    expect(s.code).toBe('T5');
    expect(s.accessEnded).toBe(true);
  });
});

// ── Critical rule: two different zeros (§19 p.6) ─────────────────────────────

describe('rule: device_limit 0 = UNLIMITED, not "0 devices"', () => {
  it('device_limit 0 + 5 connected → unlimited free slot (P2), never "limit reached"', () => {
    const s = run(makeSub({ device_limit: 0 }), { connectedDevices: 5 });
    expect(s.deviceZone.unlimited).toBe(true);
    expect(s.deviceZone.atLimit).toBe(false);
    expect(s.code).toBe('P2');
    expect(s.deviceZone.kind).toBe('connect_more');
  });

  it('device_limit 0 + 0 connected → connect (P1), the OTHER zero (counter)', () => {
    const s = run(makeSub({ device_limit: 0 }), { connectedDevices: 0 });
    expect(s.deviceZone.unlimited).toBe(true);
    expect(s.code).toBe('P1');
    expect(s.deviceZone.kind).toBe('connect');
  });
});

// ── Flag: panel down (panel_ok=false) (§4) ───────────────────────────────────

describe('flag: panel down', () => {
  it('always surfaces panelDown when panel_ok=false', () => {
    const s = run(makeSub(), { connectedDevices: 1, panelOk: false });
    expect(s.panelDown).toBe(true);
  });

  it('does NOT burn "connect" on untrusted 0 devices (P1 → no false connect)', () => {
    const s = run(makeSub(), { connectedDevices: 0, panelOk: false });
    expect(s.burning).not.toBe('connect');
    expect(s.deviceZone.kind).toBe('hidden');
  });

  it('P7 with panel down → falls back to renew, not connect', () => {
    const s = run(makeSub({ days_left: 2 }), { connectedDevices: 0, panelOk: false });
    expect(s.burning).toBe('sell');
    expect(s.sellZone.kind).toBe('renew');
  });

  it('panel_ok defaults to true when field absent', () => {
    const s = run(makeSub(), { connectedDevices: 0 });
    expect(s.panelDown).toBe(false);
    expect(s.burning).toBe('connect');
  });
});

// ── Stub: P5a / autopay (deferred) ───────────────────────────────────────────

describe('stub: autopay (P5a deferred)', () => {
  it('autopayWillCharge is always false; never produces P5a', () => {
    const s = run(makeSub({ days_left: 2, autopay_enabled: true }), { connectedDevices: 1 });
    expect(s.autopayWillCharge).toBe(false);
    expect(s.code).not.toBe('P5a');
    expect(s.code).toBe('P5');
  });
});

// ── Connection link visibility ───────────────────────────────────────────────

describe('connection link visibility', () => {
  it('respects the global hide flag', () => {
    const s = run(makeSub({ hide_subscription_link: true }), { connectedDevices: 1 });
    expect(s.linkVisible).toBe(false);
  });
});

// ── Traffic info ─────────────────────────────────────────────────────────────

describe('traffic info', () => {
  it('unlimited tariff is never "exhausted"', () => {
    const s = run(makeSub({ traffic_limit_gb: 0, traffic_used_gb: 999, is_limited: false }), {
      connectedDevices: 1,
    });
    expect(s.traffic.unlimited).toBe(true);
    expect(s.trafficExhausted).toBe(false);
  });

  it('uses the refresh override when provided', () => {
    const s = run(makeSub(), {
      connectedDevices: 1,
      trafficOverride: { usedGb: 55, usedPercent: 55, isUnlimited: false },
    });
    expect(s.traffic.usedGb).toBe(55);
  });
});

// ── Boundary cases (review-driven) ───────────────────────────────────────────

describe('boundary cases', () => {
  it('days_left === 3 → expiring (P5); days_left === 4 → not expiring (P2)', () => {
    expect(run(makeSub({ days_left: 3 }), { connectedDevices: 1 }).code).toBe('P5');
    expect(run(makeSub({ days_left: 4 }), { connectedDevices: 1 }).code).toBe('P2');
  });

  it('purchases restricted + expired paid (P8) → renew hidden, nothing burns', () => {
    const s = run(makeSub({ is_expired: true, status: 'expired', days_left: 0 }), {
      connectedDevices: 2,
      purchasesRestricted: true,
    });
    expect(s.code).toBe('P8');
    expect(s.accessEnded).toBe(true);
    expect(s.sellZone.kind).toBe('hidden');
    expect(s.burning).toBe('none');
  });

  it('panel down on a fresh trial (T1) → no false "connect" on untrusted 0 devices', () => {
    const s = run(
      makeSub({ is_trial: true, traffic_limit_gb: 10, traffic_used_gb: 0, device_limit: 5 }),
      { connectedDevices: 0, panelOk: false },
    );
    expect(s.panelDown).toBe(true);
    expect(s.burning).not.toBe('connect');
    expect(s.deviceZone.kind).toBe('hidden');
  });
});
