import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AdminUsers.tsx', import.meta.url), 'utf8');

type UsersLocale = {
  admin: {
    users: {
      filters: { currentAccounts?: string };
      status: { deletedArchive?: string };
    };
  };
};

function locale(language: string): UsersLocale {
  return JSON.parse(
    readFileSync(new URL(`../locales/${language}.json`, import.meta.url), 'utf8'),
  ) as UsersLocale;
}

describe('AdminUsers erased-account archive filter', () => {
  it('makes the default filter an operational list and keeps deletion as an explicit archive', () => {
    expect(source).toContain("t('admin.users.filters.currentAccounts')");
    expect(source).toContain("t('admin.users.status.deletedArchive')");
    expect(source).not.toContain(
      '<option value="">{t(\'admin.users.filters.allStatuses\')}</option>',
    );
  });

  it('provides the two new labels in every cabinet language', () => {
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const users = locale(language).admin.users;
      expect(users.filters.currentAccounts).toBeTruthy();
      expect(users.status.deletedArchive).toBeTruthy();
    }
  });
});
