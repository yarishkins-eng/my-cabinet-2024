import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./AdminUsers.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/adminUsers.ts', import.meta.url), 'utf8');

type UsersLocale = {
  admin: {
    users: {
      stats: Record<string, string>;
    };
  };
};

function locale(language: string): UsersLocale {
  return JSON.parse(
    readFileSync(new URL(`../locales/${language}.json`, import.meta.url), 'utf8'),
  ) as UsersLocale;
}

describe('AdminUsers truthful statistic cards', () => {
  it('uses the new backward-compatible API fields and explanatory labels', () => {
    for (const key of ['onTrial', 'onTrialHint', 'paying', 'payingHint', 'newTodayHint']) {
      expect(pageSource).toContain(`admin.users.stats.${key}`);
    }
    expect(pageSource).toContain('stats.users_on_trial ?? 0');
    expect(pageSource).toContain('stats.users_paying ?? 0');
    expect(apiSource).toContain('users_on_trial: number');
    expect(apiSource).toContain('users_paying: number');
    expect(pageSource).not.toContain('stats.active_users');
    expect(pageSource).not.toContain('stats.users_with_active_subscription');
  });

  it('provides the five new labels and removes the dead labels in every language', () => {
    for (const language of ['ru', 'en', 'zh', 'fa']) {
      const stats = locale(language).admin.users.stats;
      for (const key of ['onTrial', 'onTrialHint', 'paying', 'payingHint', 'newTodayHint']) {
        expect(stats[key]).toBeTruthy();
      }
      expect(stats.active).toBeUndefined();
      expect(stats.withSubscription).toBeUndefined();
    }
  });
});
