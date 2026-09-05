import apiClient from './client';

// ============== Types ==============

export type AutoMessageControl = 'toggle' | 'locked' | 'server';
export type AutoMessageState = 'live' | 'quiet';
export type AutoMessageGroup = 'trial' | 'paid' | 'return' | 'other';

export interface AutoMessageParams {
  /** За сколько часов до конца пробного предупредить. Не меньше часа: бот обходит всех раз в час. */
  warn_hours?: number;
  discount_percent?: number;
  valid_hours?: number;
  trigger_days?: number;
  /** Через сколько часов ПОСЛЕ начала пробного написать тому, кто не подключился. */
  not_connected_after_hours?: number;
}

export interface AutoMessageItem {
  id: string;
  group: AutoMessageGroup;
  title: string;
  when: string;
  control: AutoMessageControl;
  enabled: boolean | null;
  state: AutoMessageState;
  quiet_reason: string | null;
  /** Уточнение к работающему сообщению. Не путать с причиной молчания. */
  note: string | null;
  /** Название сообщения, которое гасится ТЕМ ЖЕ выключателем. */
  shares_switch_with: string | null;
  /** Что случится с клиентом, если выключить. Только там, где последствие настоящее. */
  warning: string | null;
  params: AutoMessageParams | null;
  /** null — отправки этого сообщения нигде не отмечаются; экран рисует прочерк, а не ноль. */
  sent_count: number | null;
  claimed_count: number | null;
  claim_tracked: boolean;
  /** Границы полей ИМЕННО этого сообщения. Зашивать их на экране нельзя: пол
   *  «через сколько дней» у разных сообщений разный. */
  limits: Record<string, [number, number]> | null;
}

export interface AutoMessageSummary {
  total_count: number;
  live_count: number;
  configurable_count: number;
  sent_total: number;
  claimed_total: number;
  global_enabled: boolean;
  /** Скольких сообщений реально касается общий выключатель. Их пять, а не двадцать. */
  global_affects: number;
  /** Всегда false: выключатель живёт в настройках бота, отсюда он только виден. */
  global_editable_here: boolean;
  last_cycle_at: string | null;
}

export interface AutoMessageListResponse {
  summary: AutoMessageSummary;
  items: AutoMessageItem[];
}

export interface AutoMessageButton {
  label: string;
  target: string;
  /** false — кнопка открывает кабинет напрямую, и бот о нажатии не узнаёт. */
  tracked: boolean;
}

export interface AutoMessageHistoryRow {
  sent_at: string | null;
  user_ref: string;
  claimed: boolean | null;
}

export interface AutoMessageInsert {
  name: string;
  /** Чем метка может обернуться. Это целые фразы из соседних ключей, а не числа. */
  variants: string[];
}

export interface AutoMessageDetail extends AutoMessageItem {
  buttons: AutoMessageButton[];
  history: AutoMessageHistoryRow[];
  history_note: string;
  /** Текст письма, прочитанный оттуда же, откуда его берёт отправитель.
   *  Необязательные: пока бот не выложен, старый ответ этих полей не содержит,
   *  и экран обязан выглядеть ровно как до правки, а не рисовать пустой блок. */
  text?: string | null;
  /** Куски, которые бот дописывает к письму сам: ссылка на кабинет, строка тарифа. */
  text_suffixes?: string[];
  /** Метки, вместо которых подставляется не число, а другой текст. */
  text_inserts?: AutoMessageInsert[];
  /** Сообщение, у которого ТОТ ЖЕ текст. Правка одного изменит оба письма. */
  shares_text_with?: string | null;
}

export interface AutoMessagePatch {
  enabled?: boolean;
  warn_hours?: number;
  discount_percent?: number;
  valid_hours?: number;
  trigger_days?: number;
  not_connected_after_hours?: number;
}

export const GROUP_TITLES: Record<AutoMessageGroup, string> = {
  trial: 'admin.autoMessages.groups.trial',
  paid: 'admin.autoMessages.groups.paid',
  return: 'admin.autoMessages.groups.return',
  other: 'admin.autoMessages.groups.other',
};

export const GROUP_ORDER: AutoMessageGroup[] = ['trial', 'paid', 'return', 'other'];

// ============== API ==============

export const autoMessagesApi = {
  list: async (): Promise<AutoMessageListResponse> => {
    const response = await apiClient.get('/cabinet/admin/auto-messages');
    return response.data;
  },

  get: async (id: string): Promise<AutoMessageDetail> => {
    const response = await apiClient.get(`/cabinet/admin/auto-messages/${id}`);
    return response.data;
  },

  patch: async (id: string, payload: AutoMessagePatch): Promise<AutoMessageItem> => {
    const response = await apiClient.patch(`/cabinet/admin/auto-messages/${id}`, payload);
    return response.data;
  },
};
