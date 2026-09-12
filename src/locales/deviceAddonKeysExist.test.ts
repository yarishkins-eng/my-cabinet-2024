import { describe, expect, it } from 'vitest';

import en from './en.json';
import ru from './ru.json';

describe('device add-on status messages', () => {
  it.each([
    [
      ru.subscription.deviceAddon,
      'Прошлый счёт не был оплачен и закрыт.',
      'Проверяем…',
      'Счёт ещё ожидает оплаты. После оплаты статус обновится сам в течение пары минут.',
      'Счёт ещё проверяется. Повторно не оплачивайте.',
    ],
    [
      en.subscription.deviceAddon,
      'The previous invoice was not paid and has been closed.',
      'Checking…',
      'The invoice is still awaiting payment. After payment, its status will update automatically within a couple of minutes.',
      'The invoice is still being checked. Do not pay again.',
    ],
  ])(
    'keeps the customer-facing copy in each locale',
    (locale, closed, checking, pending, verifying) => {
      expect(locale.previousInvoiceClosed).toBe(closed);
      expect(locale.checkingStatus).toBe(checking);
      expect(locale.statusStillPending).toBe(pending);
      expect(locale.statusStillChecking).toBe(verifying);
    },
  );
});
