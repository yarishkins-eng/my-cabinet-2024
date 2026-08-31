// @vitest-environment jsdom

/**
 * РЕК-1, волна 2: тост о бонусе не должен показывать клиенту имя рекламной кампании.
 *
 * 🔴 Дыра, найденная скептиком и критиком полноты независимо друг от друга. Сторож на локали
 * (`src/locales/campaignBonusName.honesty.test.ts`) проверяет ИНГРЕДИЕНТЫ — строки в JSON.
 * Скептик доказал мутацией, что этого мало: дописать `bonus.campaign_name` прямо в вызов
 * `showToast` — и все 17 тестов локалей остаются зелёными. Здесь проверяется ГОТОВОЕ БЛЮДО:
 * компонент рендерится по-настоящему, и в том, что он передал тосту, имени быть не должно.
 *
 * Тем же заходом закрывается класс «имя вписали в локаль буквально, без подстановки»:
 * забор на `{{name}}` его не видит, собранный тост — видит.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CAMPAIGN_NAME = 'Кувалда & Ко 7000₽';

const showToast = vi.fn();
const clearBonus = vi.fn();
const bonus = {
  campaign_name: CAMPAIGN_NAME,
  bonus_type: 'balance',
  balance_kopeks: 5000,
  subscription_days: null,
  tariff_name: null,
};

vi.mock('./Toast', () => ({
  useToast: () => ({ showToast }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ pendingCampaignBonus: bonus, clearCampaignBonus: clearBonus }),
}));

// Переводы НАСТОЯЩИЕ, из того же ru.json, что читает продукт: подмена их заглушкой
// превратила бы сторож в проверку самой заглушки. Своя инициализация нужна потому,
// что боевой `src/i18n.ts` подгружает локали динамическим импортом, то есть асинхронно,
// и к первому рендеру перевода ещё нет — тост уходил бы с сырым ключом.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ru from '../locales/ru.json';

await i18n.use(initReactI18next).init({
  lng: 'ru',
  fallbackLng: 'ru',
  resources: { ru: { translation: ru } },
  interpolation: { escapeValue: false },
});

import CampaignBonusNotifier from './CampaignBonusNotifier';

describe('РЕК-1: собранный тост не называет кампанию', () => {
  beforeEach(() => {
    showToast.mockClear();
  });

  it('тост показан и сумму называет', () => {
    render(<CampaignBonusNotifier />);
    expect(showToast).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(showToast.mock.calls[0][0]);
    // Улика, что проверяем не пустоту: без суммы тост потерял бы весь смысл.
    expect(payload).toContain('50');
  });

  it('ни в одном поле тоста нет имени кампании', () => {
    render(<CampaignBonusNotifier />);
    const payload = JSON.stringify(showToast.mock.calls[0][0]);
    expect(payload).not.toContain(CAMPAIGN_NAME);
    expect(payload).not.toContain('Кувалда');
  });
});
