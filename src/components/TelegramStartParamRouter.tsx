import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

import { resolveStartParamPath } from '../utils/telegramStartParam';

/**
 * 🔴 Этап В-1. Приземляет человека, вернувшегося из банка, на нужный экран.
 *
 * Кнопка платёжной системы «Вернуться в магазин» ведёт на `t.me/<бот>?startapp=<метка>`;
 * Телеграм запускает мини-приложение ЗАНОВО, с чистым адресом, и метка — единственное, что
 * доезжает. Без этого возврат приземлялся бы на Главную: деньги на балансе, а покупка, ради
 * которой человек уходил платить, не видна.
 *
 * Отрабатывает РОВНО ОДИН раз за запуск (`handledRef`): метка живёт в параметрах запуска всю
 * сессию, и без замка повторное срабатывание эффекта возвращало бы человека на экран
 * результата с того места, куда он успел уйти сам.
 *
 * Живёт отдельным файлом, а не внутри `AppWithNavigator`, чтобы его можно было проверить
 * сторожем, не поднимая всё приложение.
 */
export function TelegramStartParamRouter() {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    let raw: string | undefined;
    try {
      raw = retrieveLaunchParams().tgWebAppStartParam;
    } catch {
      // Вне Телеграма параметров запуска нет — это не ошибка.
      return;
    }
    const target = resolveStartParamPath(raw);
    if (target) navigate(target, { replace: true });
  }, [navigate]);

  return null;
}
