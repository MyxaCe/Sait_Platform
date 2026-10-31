// Импорт по субпутям, а не из бочки 'jose': баррель тянет JWE-ветку с
// DecompressionStream (Node-only), и middleware (edge) ругался на неё, хотя
// мы шифрование не используем. jwt/verify + jwt/sign — только JWS, edge-чистый.
import { SignJWT } from 'jose/jwt/sign';
import { jwtVerify } from 'jose/jwt/verify';

/**
 * Операторская сессия центра управления (ADM-01, Р-394/Р-395).
 *
 * ЭТО КАРКАС И СТАБ. Настоящий вход оператора (пакет C) будет сверять логин и
 * пароль с таблицей `operators` (фундамент ADM-01: колонки `login`,
 * `display_name`, `role`, `disabled_at`) и выпускать эту сессию только живому,
 * не отключённому оператору. Здесь механизма логина ещё нет — есть только
 * ПРОВЕРКА уже выпущенного подписанного токена, по образцу того, как кабинет
 * подписывает handoff-JWT для терминала (`apps/cabinet/lib/sso/jwt.ts`).
 *
 * Отличие от кабинета осознанное: клиентская сессия кабинета — opaque-токен с
 * строкой в БД (`sessions`), операторская здесь — самодостаточный HS256-JWT.
 * Это РАЗНЫЕ механизмы в РАЗНЫХ областях (разная кука, разный секрет, разный
 * issuer/audience), поэтому клиентская кука не может сойти за операторскую и
 * наоборот — даже если обе окажутся у одного браузера.
 *
 * Весь модуль edge-совместим (только `jose` поверх Web Crypto, без `node:*`),
 * чтобы гейт мог проверять сессию прямо в middleware — один вопрос на входе.
 */

export const ADMIN_ISSUER = 'platform-admin';
export const ADMIN_AUDIENCE = 'admin-center';
/** Смена оператора: 8 часов. Протухший токен = закрытый гейт (Р-394). */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type OperatorRole = 'admin' | 'operator';

export interface OperatorSession {
  /** `operators.id` — UUID оператора. */
  operatorId: string;
  /** `operators.login`. */
  login: string;
  /** `operators.display_name` — имя для шапки центра управления. */
  displayName: string;
  /** `operators.role`. */
  role: OperatorRole;
}

/**
 * Секрет подписи операторской сессии или `null`, если он не задан.
 *
 * `null` — это НЕ ошибка конфигурации, которую где-то поймают: это закрытый
 * гейт (Р-394). Нет секрета → ни один токен не может быть признан валидным →
 * внутрь не пускают никого. Fail-closed начинается здесь.
 */
function getSecret(): Uint8Array | null {
  const raw = process.env.ADMIN_SESSION_SECRET;
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function asRole(value: unknown): OperatorRole | null {
  return value === 'admin' || value === 'operator' ? value : null;
}

/**
 * Проверка операторской сессии. Возвращает оператора ТОЛЬКО при полностью
 * валидном токене; во всех остальных случаях — `null` («нельзя»).
 *
 * Молчание = «нельзя» (Р-394): нет токена, нет секрета, подпись не сходится,
 * срок истёк, не тот issuer/audience, кривой payload — любой из этих исходов
 * закрывает гейт. Ни одна ветка не открывает доступ «на всякий случай».
 */
export async function verifyOperatorSession(
  token: string | undefined,
): Promise<OperatorSession | null> {
  if (!token) return null;

  const secret = getSecret();
  if (!secret) {
    // Называем в логе, но доступ закрыт (Р-394). Без секрета поверхность
    // управления просто не открывается — это дефолт, а не поломка.
    console.error(
      '[admin-gate] ADMIN_SESSION_SECRET не задан — операторская сессия невалидна, ' +
        'доступ закрыт по умолчанию (Р-394)',
    );
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
    });

    const role = asRole(payload.role);
    const login = typeof payload.login === 'string' ? payload.login : null;
    const displayName = typeof payload.name === 'string' ? payload.name : null;
    const operatorId = typeof payload.sub === 'string' ? payload.sub : null;

    // Любой недостающий claim — закрытый гейт, а не частично собранный
    // оператор. «Наверное оператор» внутрь не пускают.
    if (!operatorId || !login || !displayName || !role) return null;

    return { operatorId, login, displayName, role };
  } catch {
    // Подпись/срок/aud/iss не сошлись — молча «нельзя» (Р-394).
    return null;
  }
}

/**
 * Выпуск операторской сессии. СТАБ: в каркасе нет формы логина (пакет C), и
 * этот помощник существует, чтобы доказать работу гейта — им минтится токен в
 * тестах и вручную для демонстрации «с сессией — пускает». Настоящий выпуск
 * (после проверки пароля и `disabled_at IS NULL` по таблице `operators`)
 * придёт отдельной задачей и переиспользует эту же подпись.
 */
export async function issueOperatorSessionToken(
  session: OperatorSession,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET не задан — операторскую сессию выпустить нельзя');
  }
  return new SignJWT({ login: session.login, name: session.displayName, role: session.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(session.operatorId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}
