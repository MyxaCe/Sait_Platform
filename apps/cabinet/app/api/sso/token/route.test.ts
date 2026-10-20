import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CAB-02, барьеры выпуска SSO-токена.
 *
 * Выпуск — единственное место платформы, где мы чеканим токены доступа,
 * и до сих пор на него было ДВА теста, оба про форму токена. Барьеры —
 * живая сессия, rate limit, ненастроенный ключ — не проверял никто.
 * Задача при этом числилась закрытой: штаб пометил её готовой, сверяя
 * статусы пачкой. Ложное «готово» в реестре хуже устаревшего «ждёт» —
 * его никто не перечитывает.
 *
 * **Почему тесты здесь, а не в `lib/sso/jwt.test.ts`.** Барьеры стоят в
 * ручке, а `vitest` до сегодня не видел `app/**` вовсе: проверка,
 * отключённая в том режиме, где идут тесты, не существует. Файл
 * прогона (`vitest.config.ts`) изменён вместе с этим набором.
 *
 * **Что проверяется — барьер, а не свойство.** Мало убедиться, что
 * ответ `401`: нужно, чтобы токен не был ВЫПУЩЕН. Эшелонированная
 * защита делает тесты зелёными по неверной причине, и отличить умеет
 * только наблюдаемое различие — здесь это «`issueHandoffToken` не
 * вызывался ни разу».
 */

const issueHandoffToken = vi.hoisted(() =>
  vi.fn(async () => ({ token: 'signed.jwt.token', expiresIn: 60 })),
);
const getSessionUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/sso/jwt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sso/jwt')>('@/lib/sso/jwt');
  return { ...actual, issueHandoffToken };
});
vi.mock('@/lib/auth/session', () => ({ getSessionUser }));

const USER = { id: 'user-1', uid: 1, email: 'a@b.c', fullName: 'A', locale: 'ru', vipLevel: 0 };

async function post() {
  const { POST } = await import('./route');
  return POST();
}

beforeEach(async () => {
  vi.resetModules();
  issueHandoffToken.mockClear().mockResolvedValue({ token: 'signed.jwt.token', expiresIn: 60 });
  getSessionUser.mockReset().mockResolvedValue(USER);
  vi.stubEnv('SSO_PRIVATE_KEY_B64', 'ZmFrZS1rZXk=');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  const { __resetRateLimit } = await import('@/lib/rate-limit');
  __resetRateLimit();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/sso/token · живая сессия', () => {
  it('сессия жива → токен выпущен', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ tenant: 'apex-ru', expiresIn: 60 });
  });

  it('CAB-07 · срок берётся ОТ ВЫПУСКА, а не повторяется константой', async () => {
    // Решающая проверка задачи. Пока ручка писала `expiresIn:
    // SSO_TOKEN_TTL_SECONDS` отдельной строкой, ответ не зависел от того,
    // на сколько токен подписан на самом деле: правка одной строки без
    // правки другой расходилась молча. Выпуск здесь называет 42 — ответ
    // обязан сказать 42, а не 60.
    issueHandoffToken.mockResolvedValue({ token: 'signed.jwt.token', expiresIn: 42 });

    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expiresIn: 42 });
  });

  it('CAB-07 · выпуск без срока → 503 с названным кодом, токен не отдан', async () => {
    // Fail-closed и с нашей стороны тоже (Р-100). Терминал сессию без
    // срока не примет, поэтому отдать токен «хотя бы какой-то» означало бы
    // отправить человека в дверь, которая всё равно заперта, — но уже без
    // внятной причины на нашей стороне.
    const { TokenWithoutExpiryError } = await import('@/lib/sso/jwt');
    issueHandoffToken.mockRejectedValue(new TokenWithoutExpiryError('exp'));

    const res = await post();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'token_without_expiry' });
    expect(body.token).toBeUndefined();
  });

  it('погашенная сессия НЕ выпускает токен', async () => {
    // Это и есть весь механизм «выход в кабинете = выход в терминале».
    // Отказ по статусу мало что доказывает: важно, что чеканки не было.
    getSessionUser.mockResolvedValue(null);

    const res = await post();

    expect(res.status).toBe(401);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('ключа нет → 503 и тоже ни одной чеканки', async () => {
    vi.stubEnv('SSO_PRIVATE_KEY_B64', '');

    const res = await post();

    expect(res.status).toBe(503);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('ненастроенность проверяется ДО сессии — ручка не ходит в базу зря', async () => {
    // Порядок барьеров: `sso_not_configured` — про конфигурацию контура,
    // и выяснять его походом в БД не нужно. Заодно это различает два
    // отказа, которые иначе слиплись бы в один 401.
    vi.stubEnv('SSO_PRIVATE_KEY_B64', '');

    await post();

    expect(getSessionUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/sso/token · ограничение частоты', () => {
  it('срабатывает: 31-й выпуск в окне отказан, и токен не чеканится', async () => {
    // Порог настоящий (30/мин у ручки), а не выдуманный тестом: эталон,
    // снятый с реализации, закрепил бы её ошибку, но здесь порог и ЕСТЬ
    // предмет проверки — его меняют вместе с этим тестом.
    for (let i = 0; i < 30; i += 1) {
      expect((await post()).status).toBe(200);
    }
    issueHandoffToken.mockClear();

    const res = await post();

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rateLimited' });
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('счёт ведётся по пользователю, а не на всю ручку', async () => {
    // Растяжка. Общий счётчик сделал бы одного клиента способным
    // закрыть вход всем остальным — отказ в обслуживании вместо защиты.
    for (let i = 0; i < 30; i += 1) await post();
    expect((await post()).status).toBe(429);

    getSessionUser.mockResolvedValue({ ...USER, id: 'user-2' });

    expect((await post()).status).toBe(200);
  });

  it('отказанная попытка не чеканит и не продлевает блокировку молча', async () => {
    // Проверка того, что 429 — это именно барьер: за ним ничего не
    // происходит, и следующий пользователь не наследует чужой счёт.
    for (let i = 0; i < 31; i += 1) await post();
    const calls = issueHandoffToken.mock.calls.length;

    await post();

    expect(issueHandoffToken.mock.calls.length).toBe(calls);
    expect(calls).toBe(30);
  });
});
