/**
 * Лимиты загрузки файлов кабинета — ОДИН источник для кода и next.config.mjs
 * (поэтому .mjs: конфиг Next не импортирует TypeScript).
 *
 * KYC-документ и документ профиля идут server action'ом, а у server actions
 * Next 14 свой потолок тела запроса — 1 МБ по умолчанию. Фото паспорта с
 * телефона (2–6 МБ) отбивалось ДО нашей проверки размера, клиент видел общий
 * сбой вместо понятного «файл слишком большой». Потолок тела = лимит файла +
 * запас на multipart-обвязку и прочие поля формы; тогда файл до лимита
 * проходит, а больший получает нашу ошибку `fileTooLarge`, пока тело ≤ потолка.
 *
 * Обратный прокси (Caddy/nginx на сервере) должен пропускать не меньше
 * SERVER_ACTION_BODY_LIMIT_BYTES (у nginx по умолчанию client_max_body_size 1m).
 */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** Запас на multipart-границы, заголовки частей и остальные поля формы. */
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export const SERVER_ACTION_BODY_LIMIT_BYTES = MAX_DOC_BYTES + MULTIPART_OVERHEAD_BYTES;
