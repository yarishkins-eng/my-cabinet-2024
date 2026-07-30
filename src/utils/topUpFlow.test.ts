import { describe, expect, it } from 'vitest';

import type { PaymentMethod } from '../types';
import { getTopUpDestination } from './topUpFlow';

const method = (id: string, is_available = true): PaymentMethod => ({
  id,
  name: id,
  description: null,
  min_amount_kopeks: 10_000,
  max_amount_kopeks: 10_000_000,
  is_available,
});

describe('getTopUpDestination', () => {
  it('does not expose a payment action when no provider is available', () => {
    expect(getTopUpDestination([])).toBeNull();
    expect(getTopUpDestination([method('platega', false)])).toBeNull();
  });

  it('opens the amount screen directly when there is one available provider', () => {
    expect(getTopUpDestination([method('platega')])).toBe('/balance/top-up/platega');
  });

  it('keeps the method selector when there is more than one available provider', () => {
    expect(getTopUpDestination([method('platega'), method('cryptobot')])).toBe('/balance/top-up');
  });
});
