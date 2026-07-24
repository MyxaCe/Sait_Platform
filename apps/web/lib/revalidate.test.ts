import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetRevalidateState,
  ALLOWED_TAG_PATTERN,
  claimDeferredInvalidate,
  completeDeferredInvalidate,
  isDuplicateEvent,
  shouldInvalidate,
  verifySignature,
} from './revalidate';

const SECRET = 'test-secret';
const sign = (body: string) =>
  `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;

beforeEach(() => __resetRevalidateState());

describe('verifySignature', () => {
  it('принимает корректную подпись', () => {
    const body = '{"tags":["cms:brand"]}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it('отклоняет: неверный секрет, изменённое тело, мусорный заголовок', () => {
    const body = '{"tags":["cms:brand"]}';
    expect(verifySignature(body, sign(body), 'wrong-secret')).toBe(false);
    expect(verifySignature(body + ' ', sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, 'sha256=zzzz', SECRET)).toBe(false);
    expect(verifySignature(body, 'md5=abc', SECRET)).toBe(false);
  });
});

describe('shouldInvalidate (cooldown)', () => {
  it('пропускает первый вызов и блокирует повтор внутри cooldown', () => {
    expect(shouldInvalidate('cms:brand', 1_000)).toBe(true);
    expect(shouldInvalidate('cms:brand', 2_000)).toBe(false);
    expect(shouldInvalidate('cms:brand', 3_500)).toBe(true);
  });

  it('теги независимы', () => {
    expect(shouldInvalidate('cms:brand', 1_000)).toBe(true);
    expect(shouldInvalidate('cms:faq', 1_000)).toBe(true);
  });
});

describe('claimDeferredInvalidate (B-011: cooldown откладывает, а не теряет)', () => {
  it('первый опоздавший получает задержку до конца cooldown, повторные коалесцируются', () => {
    expect(shouldInvalidate('cms:faq', 1_000, 2_000)).toBe(true);
    // событие через 500 мс после инвалидации: ждать остаток окна 1500 мс (+джиттер 50)
    const delay = claimDeferredInvalidate('cms:faq', 1_500, 2_000);
    expect(delay).toBe(1_550);
    // пока отложенная не выполнена — параллельные события не получают право
    expect(claimDeferredInvalidate('cms:faq', 1_600, 2_000)).toBeNull();
  });

  it('после completeDeferredInvalidate тег снова живёт по обычному cooldown', () => {
    shouldInvalidate('cms:brand', 1_000, 2_000);
    expect(claimDeferredInvalidate('cms:brand', 1_500, 2_000)).toBe(1_550);
    completeDeferredInvalidate('cms:brand', 3_050);
    // право снова свободно, а lastInvalidatedAt обновлён моментом отложенного вызова
    expect(shouldInvalidate('cms:brand', 3_100, 2_000)).toBe(false);
    expect(claimDeferredInvalidate('cms:brand', 3_100, 2_000)).toBe(2_000);
  });

  it('тег без истории ждёт полный cooldown (защитный дефолт)', () => {
    expect(claimDeferredInvalidate('cms:legal', 5_000, 2_000)).toBe(2_050);
  });
});

describe('isDuplicateEvent', () => {
  it('дедуплицирует по event_id', () => {
    expect(isDuplicateEvent('evt-1')).toBe(false);
    expect(isDuplicateEvent('evt-1')).toBe(true);
    expect(isDuplicateEvent('evt-2')).toBe(false);
  });
});

describe('ALLOWED_TAG_PATTERN', () => {
  it('пропускает контентные теги и режет произвольные', () => {
    expect(ALLOWED_TAG_PATTERN.test('cms:brand')).toBe(true);
    expect(ALLOWED_TAG_PATTERN.test('cms:page:home')).toBe(true);
    expect(ALLOWED_TAG_PATTERN.test('anything')).toBe(false);
    expect(ALLOWED_TAG_PATTERN.test('cms:BRAND')).toBe(false);
    expect(ALLOWED_TAG_PATTERN.test('cms:a;drop')).toBe(false);
  });
});
