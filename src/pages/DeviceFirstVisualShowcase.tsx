import { DeviceFirstConfigurator } from '@/components/subscription/purchase/DeviceFirstConfigurator';
import type {
  DeviceFirstCheckout,
  DeviceFirstOptions,
  DeviceFirstUiState,
} from '@/api/deviceFirst';

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
  period_options: [30, 90],
  default_period_days: 30,
  current_subscription: { id: 42, device_limit: 1, is_trial: false },
  price_matrix: [
    {
      period_days: 30,
      prices: [
        {
          device_limit: 1,
          price_kopeks: 89000,
          breakdown: {
            base_price_kopeks: 89000,
            devices_price_kopeks: 0,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
        {
          device_limit: 3,
          price_kopeks: 109000,
          breakdown: {
            base_price_kopeks: 89000,
            devices_price_kopeks: 20000,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
        {
          device_limit: 5,
          price_kopeks: 129000,
          breakdown: {
            base_price_kopeks: 89000,
            devices_price_kopeks: 40000,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
    {
      period_days: 90,
      prices: [
        {
          device_limit: 1,
          price_kopeks: 239000,
          breakdown: {
            base_price_kopeks: 239000,
            devices_price_kopeks: 0,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
        {
          device_limit: 3,
          price_kopeks: 299000,
          breakdown: {
            base_price_kopeks: 239000,
            devices_price_kopeks: 60000,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
        {
          device_limit: 5,
          price_kopeks: 359000,
          breakdown: {
            base_price_kopeks: 239000,
            devices_price_kopeks: 120000,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
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
    lifecycle_state: lifecycleByUi[uiState],
    funding_state: uiState === 'awaiting_payment' ? 'insufficient' : 'funded',
    provisioning_state:
      uiState === 'ready' ? 'ready' : uiState === 'provisioning' ? 'pending' : 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: uiState === 'ready' || uiState === 'provisioning' ? 42 : null,
    current_device_limit: 1,
    estimated_end_at: '2026-08-29T12:00:00+03:00',
    balance_kopeks: uiState === 'awaiting_payment' ? 50000 : 150000,
    shortage_kopeks: uiState === 'awaiting_payment' ? 59000 : 0,
  };
}

const states: DeviceFirstUiState[] = [
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
              <div className="mb-2 font-mono text-xs text-dark-500">{state}</div>
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
