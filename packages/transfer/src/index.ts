/**
 * `@broker/transfer` — перевод клиента на другую платформу группы
 * (ДЕМО-менеджеры, функция 2; решения владельца 10.11).
 *
 * Пакет общий для админки (проведение, возврат, приём межплатформенных
 * сообщений, воркер) и кабинета (регистрация по приглашению).
 */
export * from './envelope';
export * from './registry';
export * from './policy';
export * from './evidence';
export * from './common';
export * from './messages';
export * from './source';
export * from './target';
export * from './channel';
export * from './queries';
export * from './worker';
