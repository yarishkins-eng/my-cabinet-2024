import { DeviceFirstConfigurator } from '@/components/subscription/purchase/DeviceFirstConfigurator';
import type {
  DeviceFirstCheckout,
  DeviceFirstOptions,
  DeviceFirstUiState,
} from '@/api/deviceFirst';

const deviceLimits = [1, 3, 5];

function priceRow(periodDays: number, amounts: number[]) {
  return {
    period_days: periodDays,
    prices: amounts.map((price_kopeks, index) => ({
      device_limit: deviceLimits[index],
      price_kopeks,
      breakdown: {
        base_price_kopeks: amounts[0],
        devices_price_kopeks: price_kopeks - amounts[0],
        promo_group_discount_kopeks: 0,
        promo_offer_discount_kopeks: 0,
      },
    })),
  };
}

const options: DeviceFirstOptions = {
  eligible: true,
  tariff: {
    id: 7,
    name: 'Премиум',
    traffic_limit_gb: 100,
    base_device_limit: 1,
    pricing_revision: 4,
  },
  device_options: [1, 3, 5],
  period_options: [30, 90, 180, 365],
  default_period_days: 30,
  current_subscription: { id: 42, device_limit: 1, is_trial: false },
  price_matrix: [
    priceRow(30, [89000, 109000, 129000]),
    priceRow(90, [239000, 299000, 359000]),
    priceRow(180, [449000, 569000, 689000]),
    priceRow(365, [849000, 1089000, 1329000]),
  ],
};

function checkout(uiState: DeviceFirstUiState): DeviceFirstCheckout {
  const lifecycleByUi: Record<DeviceFirstUiState, string> = {
    configuration: 'draft',
    confirmation: 'confirmed',
    awaiting_payment: 'awaiting_funds',
    processing: 'fulfilling',
    provisioning: 'ready',
    ready: 'ready',
    reprice_required: 'reprice_required',
    conflict: 'conflict',
    cancelled: 'cancelled',
    expired: 'expired',
    failed: 'failed',
    operator_review: 'operator_review',
  };
  return {
    id: `fixture-${uiState}`,
    tariff_id: 7,
    target_subscription_id: 42,
    period_days: 30,
    selected_device_limit: 3,
    price_breakdown: {
      base_price_kopeks: 89000,
      devices_price_kopeks: 20000,
      promo_group_discount_kopeks: 0,
      promo_offer_discount_kopeks: 0,
    },
    quoted_price_kopeks: 109000,
    max_price_kopeks: 109000,
    settlement_mode: 'direct_purchase_v2',
    tariff_total_kopeks: 109000,
    wallet_applied_kopeks: 0,
    external_payable_kopeks: uiState === 'awaiting_payment' ? 109000 : 0,
    funding_mode: uiState === 'awaiting_payment' ? 'platega' : null,
    lifecycle_state: lifecycleByUi[uiState],
    funding_state: uiState === 'awaiting_payment' ? 'insufficient' : 'funded',
    provisioning_state:
      uiState === 'ready' ? 'ready' : uiState === 'provisioning' ? 'pending' : 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: uiState === 'ready' || uiState === 'provisioning' ? 42 : null,
    current_device_limit: 1,
    current_subscription_is_trial: false,
    estimated_end_at: '2026-08-29T12:00:00+03:00',
    expires_at: '2026-08-02T12:15:00+03:00',
    balance_kopeks: uiState === 'awaiting_payment' ? 50000 : 150000,
    shortage_kopeks: uiState === 'awaiting_payment' ? 59000 : 0,
    top_up_surplus_kopeks: 0,
  };
}

const states: DeviceFirstUiState[] = [
  'configuration',
  'confirmation',
  'awaiting_payment',
  'processing',
  'provisioning',
  'ready',
  'reprice_required',
  'conflict',
];

export default function DeviceFirstVisualShowcase() {
  return (
    <main className="min-h-screen bg-dark-950 px-4 py-8 text-dark-50">
      <div className="mx-auto max-w-[1240px]">
        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-accent-400">
            Device-first · production component visual QA
          </div>
          <h1 className="mt-2 text-3xl font-bold">Матрица состояний покупки</h1>
          <p className="mt-2 text-sm text-dark-400">
            Production-компонент на локальных фикстурах; API, платежи и production-данные не
            используются.
          </p>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <article data-state="configuration">
            <div className="mb-2 font-mono text-xs text-dark-500">configuration</div>
            <DeviceFirstConfigurator options={options} />
          </article>
          {states.map((state) => (
            <article key={state} data-state={state}>
              <div className="mb-2 font-mono text-xs text-dark-500">
                {/* A configuration fixture renders the legacy-draft drain
                    screen; a direct-settlement confirmation is a live order
                    and resumes through the row-wired local confirmation. */}
                {state === 'configuration'
                  ? 'legacy draft → drain'
                  : state === 'confirmation'
                    ? 'direct confirmation → resume'
                    : state}
              </div>
              <DeviceFirstConfigurator
                options={options}
                fixtureCheckout={checkout(state)}
                fixtureMethods={[
                  { key: 'sbp', provider_code: 2 },
                  { key: 'cards_ru', provider_code: 11 },
                ]}
              />
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
