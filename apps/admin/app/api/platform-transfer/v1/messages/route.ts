import { NextResponse } from 'next/server';
import { handleIncoming } from '@broker/transfer';
import { selfSlug, transferPool } from '@/lib/transfer/runtime';

/**
 * Приём межплатформенных сообщений перевода (контракт v1, `@broker/transfer`):
 * `transfer.package` (источник → цель), `transfer.revoke` (источник → цель),
 * `transfer.status` (цель → источник).
 *
 * Публичен для middleware (в `API_PUBLIC_PATHS`), но доверие — только по
 * подписи: Ed25519 ключом отправителя из реестра группы, nonce одноразовый,
 * `issuedAt` в окне ±5 мин. Ответ — машинный код, без подробностей о
 * внутреннем состоянии.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const slug = selfSlug();
  if (!slug) return NextResponse.json({ ok: false, code: 'selfNotConfigured' }, { status: 503 });
  const body = await request.text();
  try {
    const res = await handleIncoming(transferPool(), body, { selfSlug: slug });
    return NextResponse.json(res.body, { status: res.status });
  } catch (error) {
    console.error('[transfer] приём сообщения: сбой', (error as Error).message);
    return NextResponse.json({ ok: false, code: 'internal' }, { status: 503 });
  }
}
