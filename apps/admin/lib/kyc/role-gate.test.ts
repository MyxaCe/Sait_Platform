import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorRole } from '../auth/session';

/**
 * Server actions KYC/AML — роль-гейт по матрице разделов. Action можно вызвать
 * POST-ом на любую разрешённую роли страницу, поэтому middleware его не ловит:
 * отказ обязан случиться в самом action, ДО чтения базы и подписи ссылки.
 */
const session = vi.hoisted(() => ({ role: 'admin' as OperatorRole | null }));
const query = vi.hoisted(() => vi.fn());
const issueViewUrl = vi.hoisted(() => vi.fn(async () => 'https://signed.example/x'));
const decide = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, reason: 'stub' })));
const screening = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, reason: 'stub' })));

vi.mock('../auth/current', () => ({
  getOperatorSession: async () =>
    session.role ? { operatorId: 'op-1', role: session.role, displayName: 'Тест', login: 't' } : null,
}));
vi.mock('../db', () => ({ getPool: () => ({ query }) }));
vi.mock('../journal/journal', () => ({ appendJournalEntry: vi.fn(async () => undefined) }));
vi.mock('@broker/storage', () => ({ issueViewUrl }));
vi.mock('./decide', () => ({ decideClientVerification: decide }));
vi.mock('../aml/screening', () => ({ recordAmlScreening: screening, clearAmlEscalation: screening }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { issueDocumentViewUrlAction } = await import('./documents');
const { verifyClientAction } = await import('./actions');
const { recordScreeningAction } = await import('../aml/actions');

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ user_id: 'u1', doc_kind: 'passport', storage_key: 'kyc/u1/p' }] });
  issueViewUrl.mockClear();
  decide.mockClear();
  screening.mockClear();
});

describe('KYC-документ: presign только admin и operator', () => {
  for (const role of ['finance_operator', 'support_operator'] as const) {
    it(`${role} — отказ без чтения базы и без подписи`, async () => {
      session.role = role;
      expect(await issueDocumentViewUrlAction('d1')).toEqual({ ok: false, reason: 'unauthorized' });
      expect(query).not.toHaveBeenCalled();
      expect(issueViewUrl).not.toHaveBeenCalled();
    });
  }
  for (const role of ['admin', 'operator'] as const) {
    it(`${role} — ссылка выдаётся`, async () => {
      session.role = role;
      expect(await issueDocumentViewUrlAction('d1')).toEqual({ ok: true, url: 'https://signed.example/x' });
    });
  }
  it('без сессии — отказ', async () => {
    session.role = null;
    expect(await issueDocumentViewUrlAction('d1')).toEqual({ ok: false, reason: 'unauthorized' });
  });
});

describe('решение KYC и AML-скрининг — только роли разделов', () => {
  for (const role of ['finance_operator', 'support_operator'] as const) {
    it(`${role} — forbidden, решение не вызывается`, async () => {
      session.role = role;
      expect(await verifyClientAction({}, form({ userId: 'u1' }))).toEqual({ error: 'forbidden' });
      expect(decide).not.toHaveBeenCalled();
      expect(await recordScreeningAction({}, form({ userId: 'u1', outcome: 'clear' }))).toEqual({ error: 'forbidden' });
      expect(screening).not.toHaveBeenCalled();
    });
  }
  it('operator — проходит гейт (доходит до решения)', async () => {
    session.role = 'operator';
    expect(await verifyClientAction({}, form({ userId: 'u1' }))).toEqual({ error: 'stub' });
    expect(decide).toHaveBeenCalledOnce();
  });
});
