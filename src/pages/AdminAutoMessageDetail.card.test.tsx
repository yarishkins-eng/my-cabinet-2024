// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const { get, patch, confirmOff } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  confirmOff: vi.fn(),
}));

vi.mock('../api/autoMessages', async () => {
  const actual = await vi.importActual<typeof import('../api/autoMessages')>('../api/autoMessages');
  return { ...actual, autoMessagesApi: { get, patch } };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'trial-2h' }) };
});

vi.mock('../platform/hooks/useNativeDialog', () => ({
  useDestructiveConfirm: () => confirmOff,
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true, hasNativeDialogs: false } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${Object.values(vars).join(' ')}` : key,
  }),
}));

import AdminAutoMessageDetail from './AdminAutoMessageDetail';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trial-2h',
    group: 'trial',
    title: 'Пробный скоро закончится',
    when: 'За 2 часа до конца пробного периода',
    text: 'Ваша тестовая подписка истекает через 2 часа.',
    text_source: 'code',
    text_has_english: true,
    text_with_logo: true,
    text_limits: { max: 4000, caption: 1024 },
    text_markers: [] as { name: string; what: string; example: string }[],
    control: 'toggle',
    enabled: true,
    state: 'live',
    quiet_reason: null,
    note: null,
    shares_switch_with: null,
    warning: null,
    params: { warn_hours: 2 },
    limits: { warn_hours: [2, 48] },
    buttons: [{ label: '💎 Оформить подписку', target: 'Экран тарифов', tracked: false }],
    sent_count: 12,
    claimed_count: 0,
    claim_tracked: false,
    history: [{ sent_at: '2026-09-01T10:00:00Z', user_ref: 'id 42', claimed: false }],
    history_note: 'Отправки стираются при продлении',
    ...overrides,
  };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminAutoMessageDetail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminAutoMessageDetail: управление живёт здесь', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    confirmOff.mockReset();
    patch.mockResolvedValue({});
  });
  afterEach(cleanup);

  it('переключатель есть в карточке и спрашивает подтверждение перед выключением', async () => {
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(true);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: false }));
  });

  it('отказ в подтверждении ничего не отправляет', async () => {
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(false);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
  });

  it('включение обратно подтверждения не требует', async () => {
    get.mockResolvedValue(
      card({ enabled: false, state: 'quiet', quiet_reason: 'выключено здесь' }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: true }));
    expect(confirmOff).not.toHaveBeenCalled();
  });

  it('парное сообщение честно говорит, что гаснет не одно', async () => {
    // Один и тот же кусок кода пишет два письма. Молчаливый общий выключатель —
    // это ровно та ловушка, из-за которой затевался весь этап.
    get.mockResolvedValue(card({ shares_switch_with: 'Подписка закончилась' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/detail\.sharesSwitch Подписка закончилась/)).toBeTruthy(),
    );
  });

  it('предупреждение о последствии показывается', async () => {
    get.mockResolvedValue(card({ warning: 'Клиент не узнает, почему пропал VPN' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('Клиент не узнает, почему пропал VPN')).toBeTruthy(),
    );
  });

  it('выбор значения не уходит на сервер до «Сохранить»', async () => {
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    expect(patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { warn_hours: 6 }));
  });

  it('два часа — самое малое, что можно выбрать', async () => {
    // Бот спит час ПОСЛЕ обхода, значит шаг между обходами больше часа, а окно
    // поиска шириной ровно N. При одном часе часть клиентов не попадёт в него
    // вовсе — молча. Поэтому ни «1 ч», ни минут на экране нет.
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('2 ч')).toBeTruthy());
    expect(screen.queryByText('1 ч')).toBeNull();
    expect(screen.queryByText('0 ч')).toBeNull();
  });

  it('молчание по внешней причине не соседствует со словом «включено»', async () => {
    // 🔴 Первую правку я сделал так, что рядом вставали «Сейчас не отправляется»
    // и «Сообщение включено» — противоречие не исчезло, а переехало строкой ниже.
    get.mockResolvedValue(
      card({ state: 'quiet', quiet_reason: 'выключено общим переключателем', enabled: true }),
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.notSending')).toBeTruthy(),
    );
    expect(screen.getByText('admin.autoMessages.detail.ownSwitchOn')).toBeTruthy();
    expect(screen.queryByText('admin.autoMessages.detail.switchOn')).toBeNull();
  });

  it('о собственном выключении не говорится трижды', async () => {
    get.mockResolvedValue(
      card({ state: 'quiet', quiet_reason: 'выключено в этом разделе', enabled: false }),
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.notSending')).toBeTruthy(),
    );
    expect(screen.queryByText('admin.autoMessages.detail.ownSwitchOn')).toBeNull();
    expect(screen.queryByText('admin.autoMessages.detail.switchOff')).toBeNull();
  });

  it('молчащее сообщение не выдаётся за работающее', async () => {
    // 🔴 Список писал «не отправляется», а карточка на той же записи — «включено».
    // Врал тот экран, куда менеджер зашёл читать подробности.
    get.mockResolvedValue(
      card({ state: 'quiet', quiet_reason: 'суточных тарифов не заведено', enabled: true }),
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.notSending')).toBeTruthy(),
    );
    expect(screen.getByText('суточных тарифов не заведено')).toBeTruthy();
  });

  it('подтверждение называет обе стороны пары', async () => {
    // Умолчать здесь — значит дать выключить «Подписка истекла» тому, кто этого
    // не хотел: своё предупреждение о последствиях лежит на ДРУГОЙ карточке.
    get.mockResolvedValue(card({ shares_switch_with: 'Подписка закончилась' }));
    confirmOff.mockResolvedValue(false);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(confirmOff.mock.calls[0][0]).toContain('Подписка закончилась');
  });

  it('начатая правка числа переживает щелчок тумблером', async () => {
    // Карточка перезапрашивается после щелчка, приходит новый объект с теми же
    // числами — и выбранное «6 ч» молча возвращалось к серверным «2 ч».
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(true);
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: false }));
    expect(screen.getByText('admin.autoMessages.save.action')).toBeTruthy();
  });

  it('«Отменить» возвращает исходное значение и убирает кнопки', async () => {
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    await waitFor(() => expect(screen.getByText('admin.autoMessages.save.cancel')).toBeTruthy());

    fireEvent.click(screen.getByText('admin.autoMessages.save.cancel'));
    await waitFor(() => expect(screen.queryByText('admin.autoMessages.save.action')).toBeNull());
    expect(patch).not.toHaveBeenCalled();
  });

  it('отказ сервера показывается его словами', async () => {
    get.mockResolvedValue(card());
    const axios = await import('axios');
    vi.spyOn(axios.default, 'isAxiosError').mockReturnValue(true);
    patch.mockRejectedValue({
      response: { data: { detail: 'Скидку больше 50 % ставить нельзя' } },
    });
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));

    await waitFor(() => expect(screen.getByText('Скидку больше 50 % ставить нельзя')).toBeTruthy());
  });

  it('там, где счёта нет, сказано прямо — и что это не ноль', async () => {
    get.mockResolvedValue(card({ sent_count: null, history: [] }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.history.notCounted')).toBeTruthy(),
    );
  });

  it('текст письма виден — тот, что придёт клиенту', async () => {
    // Это и есть весь смысл АС-10: до него владелец включал рассылку живым людям,
    // не зная её содержания.
    get.mockResolvedValue(
      card({
        text: '🎁 <b>Тестовая подписка</b>\n\nОсталось {hours_text}.',
        text_markers: [{ name: 'hours_text', what: 'сколько осталось', example: '2 часа' }],
      }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByText('admin.autoMessages.detail.text')).toBeTruthy());
    expect(screen.getByText(/Осталось \{hours_text\}/)).toBeTruthy();
    expect(screen.getByText('admin.autoMessages.detail.textBraces')).toBeTruthy();
  });

  it('разметка письма показана как оформление, а не как скобки', async () => {
    // 🔴 Клиент видит жирный заголовок; печатать ему `<b>` буквально — показывать то,
    // чего у клиента нет. Владелец не программист: он прочитает это как поломку.
    // Разметка есть в 21 письме из 22, так что это каждая карточка.
    get.mockResolvedValue(card({ text: '⛔ <b>Подписка истекла</b>\n\nПродлите доступ.' }));
    const { container } = renderCard();

    await waitFor(() => expect(container.querySelector('b')).toBeTruthy());
    expect(container.querySelector('b')?.textContent).toBe('Подписка истекла');
    expect(container.textContent).not.toContain('<b>');
  });

  it('на экране сказано, что правится русский текст, а английский не меняется', async () => {
    // Англоязычным клиентам уходит en.json, и правка их не касается. Молчание об этом
    // означает, что владелец будет уверен, будто поправил письмо всем.
    get.mockResolvedValue(card({ text: 'Пробный период завершён.' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textRussianOnly')).toBeTruthy(),
    );
  });

  it('подписи про фигурные скобки нет там, где скобок нет', async () => {
    // Есть письма без единой метки. Подпись про скобки на них заставила бы искать
    // на экране то, чего в этом письме нет вовсе. Точное число не называю: оно
    // зависит от режима бота и уже один раз было записано неверно.
    get.mockResolvedValue(card({ text: 'Подключения мы пока не видим. Что-то помешало?' }));
    renderCard();

    await waitFor(() => expect(screen.getByText(/Подключения мы пока не видим/)).toBeTruthy());
    expect(screen.queryByText('admin.autoMessages.detail.textBraces')).toBeNull();
  });

  it('пока сервер текста не прислал, блока нет вовсе — а не пустая рамка', async () => {
    // Кабинет выкладывается ПЕРВЫМ, и несколько минут отвечает старый бот. Карточка
    // обязана выглядеть ровно как до правки: пустая рамка «Текст письма» читалась бы
    // как «у письма нет текста».
    get.mockResolvedValue(card({ text: undefined }));
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    expect(screen.queryByText('admin.autoMessages.detail.text')).toBeNull();
    expect(screen.queryByText('admin.autoMessages.detail.textBraces')).toBeNull();
  });

  it('хвост, который бот дописывает сам, показан и подписан как хвост', async () => {
    get.mockResolvedValue(
      card({ text: '⛔ Подписка истекла', text_suffixes: ['\n\n🌐 Продлить можно и в браузере'] }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByText(/Продлить можно и в браузере/)).toBeTruthy());
    expect(screen.getByText('admin.autoMessages.detail.textSuffix')).toBeTruthy();
  });

  it('метка, вместо которой встаёт целая фраза, расшифрована вариантами', async () => {
    // Показать шаблон и промолчать про такие метки — значит показать предложение
    // с невидимыми дырами: у писем об истечении их две из трёх.
    get.mockResolvedValue(
      card({
        text: 'Автоплатёж: {autopay_status}',
        text_inserts: [
          {
            name: 'autopay_status',
            variants: [
              { text: 'карта привязана', when: 'автоплатёж включён' },
              { text: 'карты нет', when: 'автоплатёж выключен' },
            ],
          },
        ],
      }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByText('{autopay_status}')).toBeTruthy());
    expect(screen.getByText('карта привязана')).toBeTruthy();
    expect(screen.getByText('карты нет')).toBeTruthy();
    // Условие обязано стоять рядом с фразой: без него владелец читает список сверху
    // вниз и достраивает письмо, которого не бывает.
    expect(
      screen.getByText('admin.autoMessages.detail.textVariantWhen автоплатёж включён'),
    ).toBeTruthy();
  });

  it('у пары с общим текстом это написано словами', async () => {
    // «Поменял одно — изменилось два» уже случалось с общим выключателем; с текстом
    // ошибка была бы той же формы, только последствие видит клиент.
    get.mockResolvedValue(
      card({ text: '⚠️ Подписка истекает', shares_text_with: 'Подписка истекает завтра' }),
    );
    renderCard();

    await waitFor(() =>
      expect(
        screen.getByText('admin.autoMessages.detail.textSharesWith Подписка истекает завтра'),
      ).toBeTruthy(),
    );
  });

  it('поля правки нет, пока замок не снят', async () => {
    // 🔴 Прямое требование владельца: «через какой-то замочек». Текст читают живые
    // клиенты, и задеть его пальцем при прокрутке нельзя.
    get.mockResolvedValue(card({ text: 'Пробный период завершён.' }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    expect(container.querySelector('textarea')).toBeNull();

    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('сохранение отправляет именно то, что набрали', async () => {
    get.mockResolvedValue(card({ text: 'Старый текст.' }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    const field = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Новый текст.' } });
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textSave'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { text: 'Новый текст.' }));
  });

  it('слишком длинный текст не даёт нажать сохранение и говорит об этом', async () => {
    get.mockResolvedValue(card({ text: 'Короткий.' }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'я'.repeat(4001) },
    });

    expect(screen.getByText(/textTooLong/)).toBeTruthy();
    const save = screen.getByText('admin.autoMessages.detail.textSave') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(patch).not.toHaveBeenCalled();
  });

  it('выше предела подписи предупреждает про логотип, но сохранить даёт', async () => {
    get.mockResolvedValue(card({ text: 'Короткий.' }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'я'.repeat(1500) },
    });

    expect(screen.getByText(/textNoLogo/)).toBeTruthy();
    expect(
      (screen.getByText('admin.autoMessages.detail.textSave') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('«вернуть исходный» есть только у правленого письма и спрашивает подтверждение', async () => {
    get.mockResolvedValue(card({ text: 'Правленый текст.', text_source: 'code' }));
    const { container, unmount } = renderCard();
    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    expect(screen.queryByText('admin.autoMessages.detail.textReset')).toBeNull();
    expect(container.querySelector('textarea')).toBeTruthy();
    unmount();

    get.mockResolvedValue(card({ text: 'Правленый текст.', text_source: 'custom' }));
    confirmOff.mockResolvedValue(true);
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdited')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textReset'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { reset_text: true }));
  });

  it('метки расшифрованы простыми словами', async () => {
    // Без этого значок остаётся загадкой, и владелец боится трогать текст.
    get.mockResolvedValue(
      card({
        text: 'Скидка {percent}%',
        text_markers: [{ name: 'percent', what: 'размер скидки', example: '10' }],
      }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByText('{percent}')).toBeTruthy());
    expect(screen.getByText(/размер скидки/)).toBeTruthy();
  });

  it('верхний предпросмотр показывает то, что печатают прямо сейчас', async () => {
    // 🔴 Без этого на экране два вида одного письма: сверху жирным, снизу с тегами, и
    // верхний не менялся при наборе. Человек не понимал, какой из них настоящий.
    get.mockResolvedValue(card({ text: '<b>Старый</b> текст.' }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '<b>Новый</b> текст.' },
    });

    expect(container.querySelector('b')?.textContent).toBe('Новый');
  });

  it('отказ сервера показывается рядом с кнопкой, а не за экраном', async () => {
    // Прежде плашка стояла на 300–600 px ниже: владелец не видел, почему не сохранилось,
    // и жал ещё раз.
    get.mockResolvedValue(card({ text: 'Текст {hours_text}.' }));
    patch.mockRejectedValue({ response: { data: { detail: 'Не хватает метки {hours_text}' } } });
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'Текст без метки.' },
    });
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textSave'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не хватает метки');
    // Набранное не потеряно.
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Текст без метки.',
    );
  });

  it('у письма без английской версии сказано, что правка коснётся всех', async () => {
    get.mockResolvedValue(card({ text: 'Русский текст.', text_has_english: false }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textNoEnglish')).toBeTruthy(),
    );
    expect(screen.queryByText('admin.autoMessages.detail.textRussianOnly')).toBeNull();
  });

  it('про логотип молчит там, где логотипа не бывает', async () => {
    get.mockResolvedValue(card({ text: 'Короткий.', text_with_logo: false }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'я'.repeat(1500) },
    });

    expect(screen.queryByText(/textNoLogo/)).toBeNull();
  });

  it('сохранение не нажимается, пока текст не изменили', async () => {
    // Иначе «Изменить → Сохранить» без единой правки записывает копию кодового текста,
    // и значок «текст изменён» загорается навсегда.
    get.mockResolvedValue(card({ text: 'Ровно тот же текст.' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    expect(
      (screen.getByText('admin.autoMessages.detail.textSave') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('про общий текст сказано ДО кнопки правки и в подтверждении сброса', async () => {
    get.mockResolvedValue(
      card({
        text: 'Общий текст.',
        shares_text_with: 'Подписка истекает завтра',
        text_source: 'custom',
      }),
    );
    confirmOff.mockResolvedValue(true);
    renderCard();

    await waitFor(() =>
      expect(
        screen.getByText('admin.autoMessages.detail.textSharesWith Подписка истекает завтра'),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textReset'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(confirmOff.mock.calls[0][0]).toContain('textResetAskShared');
  });

  it('пределы длины берутся с сервера, а не зашиты в экране', async () => {
    get.mockResolvedValue(card({ text: 'Короткий.', text_limits: { max: 50, caption: 20 } }));
    const { container } = renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.textEdit')).toBeTruthy(),
    );
    fireEvent.click(screen.getByText('admin.autoMessages.detail.textEdit'));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'я'.repeat(60) },
    });

    expect(screen.getByText(/textTooLong/)).toBeTruthy();
    expect(
      (screen.getByText('admin.autoMessages.detail.textSave') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('у незыблемого сообщения переключателя нет, но сказано почему', async () => {
    // Осталось ровно одно: рычаг гасит не письмо, а сам бонус в две недели VPN.
    get.mockResolvedValue(card({ control: 'server', enabled: null, params: null }));
    renderCard();

    await waitFor(() => expect(screen.getByText('admin.autoMessages.locked.hint')).toBeTruthy());
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
