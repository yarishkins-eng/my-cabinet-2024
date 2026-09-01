// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TestAccountResetCard } from './TestAccountResetCard';
import { adminUsersApi } from '../../../api/adminUsers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // `subscriptionHelpers` тянет за собой настоящий i18n — ему нужен плагин.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value} RUB` }),
}));

vi.mock('../../../api/adminUsers', () => ({
  adminUsersApi: { testAccountReset: vi.fn() },
}));

const plan = {
  allowed: true,
  blocked_reason: null,
  done: false,
  balance_kopeks: 22450,
  subscription: 'платная, active, до 25.09.2026',
  orders: 2,
  payments: 2,
  transactions: 5,
  invited_users: 2,
  tickets: 3,
  panel_linked: true,
  panel_deleted: false,
  deleted_rows: {},
};

beforeEach(() => {
  cleanup();
  vi.mocked(adminUsersApi.testAccountReset).mockReset();
});

describe('TestAccountResetCard', () => {
  it('первое нажатие только спрашивает план и ничего не подтверждает', async () => {
    vi.mocked(adminUsersApi.testAccountReset).mockResolvedValue(plan);
    render(<TestAccountResetCard userId={196} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(adminUsersApi.testAccountReset).toHaveBeenCalledTimes(1));
    // Улика: ровно false. Проверка «вызвано один раз» без этого прошла бы и
    // на кнопке, которая сразу сносит аккаунт.
    expect(adminUsersApi.testAccountReset).toHaveBeenCalledWith(196, false);
  });

  it('сносит только вторым нажатием и сообщает наверх', async () => {
    const onDone = vi.fn();
    vi.mocked(adminUsersApi.testAccountReset)
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({ ...plan, done: true, panel_deleted: true });
    render(<TestAccountResetCard userId={196} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('admin.users.testReset.willDelete');
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('admin.users.testReset.confirm'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(adminUsersApi.testAccountReset).toHaveBeenNthCalledWith(2, 196, true);
    expect(screen.getByText('admin.users.testReset.doneTitle')).toBeTruthy();
  });

  it('отказ сервера показывается словами, и подтверждающей кнопки нет', async () => {
    vi.mocked(adminUsersApi.testAccountReset).mockResolvedValue({
      ...plan,
      allowed: false,
      blocked_reason: 'Платёж на 891.75 ₽ ещё не досверен с провайдером (VERIFYING).',
    });
    render(<TestAccountResetCard userId={185} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole('button'));

    await screen.findByText('admin.users.testReset.blockedTitle');
    expect(screen.getByText(/891\.75/)).toBeTruthy();
    expect(screen.queryByText('admin.users.testReset.confirm')).toBeNull();
  });

  it('не молчит, когда сервер отбил запрос', async () => {
    vi.mocked(adminUsersApi.testAccountReset).mockRejectedValue(new Error('boom'));
    render(<TestAccountResetCard userId={1} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole('button'));

    await screen.findByText('boom');
    expect(screen.queryByText('admin.users.testReset.willDelete')).toBeNull();
  });
});

describe('тексты раздела', () => {
  // Сторож читает сами файлы локалей: в тестах экрана переводчик подменён на
  // `t: (key) => key`, поэтому проверка по экрану о текстах не говорит ничего.
  const localeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../locales');
  const read = (lang: string) =>
    JSON.parse(readFileSync(path.join(localeDir, `${lang}.json`), 'utf-8')).admin.users.testReset;

  it('оба языка описывают раздел целиком', () => {
    const keys = [
      'title',
      'subtitle',
      'check',
      'confirm',
      'willDelete',
      'balance',
      'subscription',
      'orders',
      'payments',
      'transactions',
      'panel',
      'panelLinked',
      'nothing',
      'invitedStay',
      'tickets',
      'ticketsWarn',
      'auditStays',
      'blockedTitle',
      'doneTitle',
      'doneHint',
    ];
    for (const lang of ['ru', 'en']) {
      const block = read(lang);
      for (const key of keys) {
        expect(block[key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('честно говорит о том, чего кнопка НЕ делает', () => {
    const ru = read('ru');
    // Владелец читает это в момент необратимого действия. Обе оговорки —
    // про чужие строки, которые остаются жить, и обе обязаны там быть.
    expect(ru.invitedStay).toMatch(/не трогаем/i);
    expect(ru.auditStays).toMatch(/остаётся/i);
    // Переписка с поддержкой исчезает незаметно — экран обязан сказать.
    expect(ru.ticketsWarn).toMatch(/ответы менеджера/i);
    // И про то, что переписка в Телеграме сервером не управляется.
    expect(ru.doneHint).toMatch(/старые сообщения/i);
    expect(read('en').doneHint).toMatch(/old chat messages/i);
  });
});
