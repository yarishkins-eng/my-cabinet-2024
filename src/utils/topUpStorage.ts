const STORAGE_KEY = 'topup_pending_payment';
// 🔴 Этап В-1: было 30 минут — КОРОЧЕ, чем живёт сам счёт. Окно оплаты по СБП замерено этим
// же проектом как 30–41 минута (`DeviceFirstConfigurator.tsx`), а серверный маршрут «последний
// платёж» смотрит на час назад (`balance.py`, `/pending-payments/{method}/latest`). Человек,
// заплативший на 35-й минуте — то есть В РАЗРЕШЁННОЕ провайдером время, — терял вместе с
// записью адрес возврата на кассу и приземлялся «на баланс». Ровняем на час, по серверу.
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface TopUpPendingInfo {
  amount_kopeks: number;
  method_id: string;
  method_name: string;
  payment_id: string;
  created_at: number; // Date.now()
  /**
   * 🔴 Этап В-1. Куда вернуть человека после пополнения (`/subscription/purchase?from=checkout…`).
   * Раньше этот адрес жил ТОЛЬКО в строке браузера. Когда человек возвращается из банка кнопкой
   * провайдера, Телеграм запускает мини-приложение заново — своей строки у нас в этот момент нет,
   * и адрес возврата пропадал вместе с ней. Поэтому он лежит здесь, а не только в адресе.
   * Через сервер НЕ передаётся: чужой адрес перехода, пришедший снаружи, — это забор, которого
   * у нас нет, а хранилище тот же браузер того же человека.
   */
  return_to?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function saveTopUpPendingInfo(info: TopUpPendingInfo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  } catch {}
}

export function loadTopUpPendingInfo(): TopUpPendingInfo | null {
  try {
    // 🔴 Этап В-1: запись переехала из `sessionStorage` в `localStorage` — она обязана пережить
    // ПЕРЕЗАПУСК мини-приложения, а `sessionStorage` умирает вместе с ним. Чтение из старого
    // места оставлено намеренно: иначе человек, начавший пополнение за минуту до выкладки,
    // вернулся бы на экран без единого источника данных и был бы сброшен на баланс.
    const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      typeof parsed.amount_kopeks !== 'number' ||
      typeof parsed.method_id !== 'string' ||
      typeof parsed.method_name !== 'string' ||
      typeof parsed.payment_id !== 'string' ||
      typeof parsed.created_at !== 'number' ||
      parsed.amount_kopeks <= 0
    ) {
      return null;
    }
    // Discard stale entries
    if (Date.now() - (parsed.created_at as number) > MAX_AGE_MS) {
      clearTopUpPendingInfo();
      return null;
    }
    return {
      amount_kopeks: parsed.amount_kopeks as number,
      method_id: parsed.method_id as string,
      method_name: parsed.method_name as string,
      payment_id: parsed.payment_id as string,
      created_at: parsed.created_at as number,
      // Адрес возврата проверяется тем же забором, что и адрес из строки браузера: хранилище
      // человек может подменить руками, поэтому доверия ему не больше, чем адресной строке.
      return_to: typeof parsed.return_to === 'string' ? parsed.return_to : null,
    };
  } catch {
    return null;
  }
}

export function clearTopUpPendingInfo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
