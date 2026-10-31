import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { envOr } from '@broker/utils';

/**
 * Пароль оператора — argon2id (Р-451, не bcrypt: OWASP для нового).
 *
 * **Почему `@node-rs/argon2`, а не `argon2` (node-gyp).** Образ центра
 * управления бежит на `node:22-alpine` (musl). Классический `argon2` тянет
 * node-gyp и собирается из исходников — на musl это боль и хрупкость сборки.
 * `@node-rs/argon2` поставляет готовые бинари под платформу, включая
 * `linux-x64-musl` и `win32-x64-msvc`, поэтому ставится без компилятора и
 * одинаково работает в alpine-образе и на машине разработчика (кабинет по
 * той же причине взял чисто-JS bcryptjs; здесь нужен argon2, и музл-пребилды
 * решают ту же задачу без node-gyp).
 *
 * **Параметры — из конфига, не хардкод (Р-451).** Старт консервативный по
 * OWASP: m=64 MiB (65536 KiB), t=3, p=4. Алгоритм и параметры хранятся РЯДОМ
 * с хешем (в самой PHC-строке `$argon2id$v=19$m=…,t=…,p=…$salt$hash`), что и
 * позволяет при входе увидеть устаревшие параметры и прозрачно перехешировать.
 */

export interface ArgonParams {
  /** Память в KiB (argon2 `m`). */
  memoryCost: number;
  /** Число проходов (argon2 `t`). */
  timeCost: number;
  /** Степень параллелизма (argon2 `p`). */
  parallelism: number;
}

/** Консервативный старт по OWASP (Р-451). Переопределяется окружением. */
export const DEFAULT_ARGON_PARAMS: ArgonParams = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function intFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(envOr(raw, String(fallback)), 10);
  // Мусор в переменной — не повод молча ослабить стоимость хеша: берём
  // умолчание, а не NaN, который argon2 истолкует по-своему.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Текущие параметры хеширования: окружение поверх умолчаний OWASP. */
export function currentArgonParams(): ArgonParams {
  return {
    memoryCost: intFromEnv(process.env.ADMIN_ARGON_MEMORY_KIB, DEFAULT_ARGON_PARAMS.memoryCost),
    timeCost: intFromEnv(process.env.ADMIN_ARGON_TIME, DEFAULT_ARGON_PARAMS.timeCost),
    parallelism: intFromEnv(process.env.ADMIN_ARGON_PARALLELISM, DEFAULT_ARGON_PARAMS.parallelism),
  };
}

export function hashPassword(password: string): Promise<string> {
  const params = currentArgonParams();
  // Алгоритм явно НЕ задаём: `@node-rs/argon2` по умолчанию argon2id (это и
  // видно в PHC-строке `$argon2id$…`), а его enum `Algorithm` — const enum,
  // который при `isolatedModules` в рантайме пуст (`{}`), то есть ссылка на
  // `Algorithm.Argon2id` дала бы `undefined`. Умолчание и есть argon2id;
  // `needsRehash` всё равно требует именно argon2id и перехеширует иначе.
  return argonHash(password, {
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

/**
 * Сверка пароля с хешем. `false` при любом сбое (битая PHC-строка, не тот
 * алгоритм) — не бросаем: провал сверки и есть провал входа. Возвращать
 * исключение наверх значило бы различать «не тот пароль» и «кривой хеш»
 * там, где это ни к чему и опасно (разное время/разный ответ выдают факт).
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Разбор параметров из PHC-строки argon2: `$argon2id$v=19$m=…,t=…,p=…$…`. */
export interface ParsedPhc {
  algorithm: string;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export function parsePhc(hash: string): ParsedPhc | null {
  // $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
  const match = /^\$(argon2(?:id|i|d))\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  if (!match) return null;
  const [, algorithm, m, t, p] = match;
  if (!algorithm || !m || !t || !p) return null;
  return {
    algorithm,
    memoryCost: Number.parseInt(m, 10),
    timeCost: Number.parseInt(t, 10),
    parallelism: Number.parseInt(p, 10),
  };
}

/**
 * Нужен ли перехеш: параметры в PHC-строке хранимого хеша не совпадают с
 * текущим конфигом (Р-451). Любое расхождение — в том числе не тот вариант
 * argon2 или нечитаемая строка — означает «перехешировать при ближайшем
 * успешном входе».
 *
 * Непарсящийся хеш считаем требующим перехеша: это либо чужой формат (старый
 * bcrypt, если когда-то был), либо порча — и то и другое надо заменить на
 * свежий argon2id при первом же успешном входе.
 */
export function needsRehash(hash: string): boolean {
  const parsed = parsePhc(hash);
  if (!parsed) return true;
  if (parsed.algorithm !== 'argon2id') return true;
  const current = currentArgonParams();
  return (
    parsed.memoryCost !== current.memoryCost ||
    parsed.timeCost !== current.timeCost ||
    parsed.parallelism !== current.parallelism
  );
}
