import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  ADMIN_AUDIENCE,
  ADMIN_ISSUER,
  issueOperatorSessionToken,
  verifyOperatorSession,
  type OperatorSession,
} from './session';

const SECRET = 'test-admin-secret-value';
const OPERATOR: OperatorSession = {
  operatorId: '11111111-1111-1111-1111-111111111111',
  login: 'ops.alice',
  displayName: 'Алиса Оператор',
  role: 'operator',
};

function sign(secret: string) {
  return new TextEncoder().encode(secret);
}

describe('операторский гейт (Р-394 fail-closed)', () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.ADMIN_SESSION_SECRET;
  });

  it('нет токена → null (молчание = «нельзя»)', async () => {
    expect(await verifyOperatorSession(undefined)).toBeNull();
    expect(await verifyOperatorSession('')).toBeNull();
  });

  it('нет секрета → null, даже с правильно подписанным когда-то токеном', async () => {
    const token = await issueOperatorSessionToken(OPERATOR);
    delete process.env.ADMIN_SESSION_SECRET;
    expect(await verifyOperatorSession(token)).toBeNull();
  });

  it('мусор вместо токена → null', async () => {
    expect(await verifyOperatorSession('not-a-jwt')).toBeNull();
  });

  it('подпись чужим секретом → null', async () => {
    const token = await new SignJWT({ login: OPERATOR.login, name: OPERATOR.displayName, role: OPERATOR.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ADMIN_ISSUER)
      .setAudience(ADMIN_AUDIENCE)
      .setSubject(OPERATOR.operatorId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(sign('другой-секрет'));
    expect(await verifyOperatorSession(token)).toBeNull();
  });

  it('истёкший токен → null', async () => {
    const token = await issueOperatorSessionToken(OPERATOR, -10);
    expect(await verifyOperatorSession(token)).toBeNull();
  });

  it('не тот audience → null', async () => {
    const token = await new SignJWT({ login: OPERATOR.login, name: OPERATOR.displayName, role: OPERATOR.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ADMIN_ISSUER)
      .setAudience('cabinet')
      .setSubject(OPERATOR.operatorId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(sign(SECRET));
    expect(await verifyOperatorSession(token)).toBeNull();
  });

  it('валидная сессия без роли → null (не «наверное оператор»)', async () => {
    const token = await new SignJWT({ login: OPERATOR.login, name: OPERATOR.displayName })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ADMIN_ISSUER)
      .setAudience(ADMIN_AUDIENCE)
      .setSubject(OPERATOR.operatorId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(sign(SECRET));
    expect(await verifyOperatorSession(token)).toBeNull();
  });

  it('валидный токен оператора → гейт открыт, оператор распознан', async () => {
    const token = await issueOperatorSessionToken(OPERATOR);
    const session = await verifyOperatorSession(token);
    expect(session).toEqual(OPERATOR);
  });
});
