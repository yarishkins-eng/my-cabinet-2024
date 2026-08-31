/**
 * РЕК-6А: подсказки в админке, которые предупреждают о видимости КЛИЕНТОМ.
 *
 * Два поля, где владелец пишет текст «для себя», а читает его клиент:
 *
 * 1. «Описание» при начислении/списании баланса — 500 символов уходят прямо в историю
 *    операций клиента (`admin_users.py` → `Transaction.description` → `Balance.tsx`).
 *    Поле называлось «Описание (опционально)», ни слова о читателе не было.
 * 2. Метка рекламной кампании — публична по устройству Телеграма (см. соседний сторож).
 *    Отдельно: сменить метку постфактум значит обнулить уже размещённые ссылки.
 *
 * ⚠️ ГРАНИЦА: сторож проверяет наличие и смысл подсказок, но не отличает предупреждение от
 * его отрицания — «клиент это НЕ увидит» прошло бы зелёным. Машине смысл недоступен.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = fs.readdirSync(HERE).filter((n) => n.endsWith('.json'));

// Слово «клиент» на каждом языке: стережём смысл, а не конкретную фразу.
const CLIENT: Record<string, RegExp> = { ru: /клиент/i, en: /client/i, fa: /مشتری/, zh: /客户/ };

function locale(file: string) {
  return JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf-8'));
}

describe('РЕК-6А: админские подсказки честно говорят, что текст увидит клиент', () => {
  it('локали найдены', () => {
    expect(LOCALE_FILES.length).toBeGreaterThan(0);
  });

  it.each(LOCALE_FILES)('%s: подсказка под «Описание» называет читателя', (file) => {
    const lang = file.replace('.json', '');
    const balance = locale(file).admin.users.detail.balance;
    expect(balance.descriptionHint, 'подсказка исчезла').toBeTruthy();
    expect(CLIENT[lang], `для языка ${lang} не задано слово-признак`).toBeDefined();
    expect(balance.descriptionHint).toMatch(CLIENT[lang]);
    // И сам плейсхолдер обязан предупреждать: подсказку под полем читают не все.
    expect(balance.descriptionPlaceholder).toMatch(CLIENT[lang]);
  });

  it.each(LOCALE_FILES)('%s: предупреждение о смене метки на месте', (file) => {
    const form = locale(file).admin.campaigns.form;
    expect(form.startParameterChangeWarning, 'предупреждение исчезло').toBeTruthy();
    // Оно обязано быть ОТДЕЛЬНЫМ от обычной подсказки: на форме создания оно было бы ложью.
    expect(form.startParameterChangeWarning).not.toBe(form.startParameterHint);
  });

  it('обе подсказки реально нарисованы на своих экранах', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(HERE, '..', rel), 'utf-8');
    expect(read('components/admin/userDetail/BalanceTab.tsx')).toContain(
      'admin.users.detail.balance.descriptionHint',
    );
    expect(read('pages/AdminCampaignEdit.tsx')).toContain(
      'admin.campaigns.form.startParameterChangeWarning',
    );
    // ⛔ И НЕ нарисовано на форме создания: там смены метки ещё не было.
    expect(read('pages/AdminCampaignCreate.tsx')).not.toContain('startParameterChangeWarning');
  });
});
