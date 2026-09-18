import type { TFunction } from 'i18next';

/**
 * Текст приглашения другу — ОДИН на оба экрана («Заработок» и «Профиль»).
 *
 * До 19.09.2026 у каждого экрана была своя копия, и они разъехались: шаблон
 * `referral.shareMessage` ждёт `minimum` и `bonus`, а «Профиль» подставлял `percent` —
 * друзьям три месяца уходило «при первой оплате от {{minimum}} тебе ещё {{bonus}}».
 * i18next неизвестную подстановку оставляет как есть, ошибки не бывает — только у получателя.
 */
export type ReferralShareInput = {
  botName: string;
  /** Бонус новичку в копейках; 0 — бонус выключен, тогда текст про кешбэк. */
  firstTopupBonusKopeks: number;
  /** Уже отформатированные суммы с валютой, например «100 ₽». */
  minimum: string;
  bonus: string;
  percent: number;
};

export function buildReferralShareText(t: TFunction, input: ReferralShareInput): string {
  if (input.firstTopupBonusKopeks > 0) {
    return t('referral.shareMessage', {
      botName: input.botName,
      minimum: input.minimum,
      bonus: input.bonus,
    });
  }
  return t('referral.shareMessageCashback', {
    botName: input.botName,
    percent: input.percent,
  });
}
