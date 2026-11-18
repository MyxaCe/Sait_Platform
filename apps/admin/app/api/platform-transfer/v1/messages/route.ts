import { NextResponse } from 'next/server';
import { handleIncoming } from '@broker/transfer';
import { selfSlug, transferPool } from '@/lib/transfer/runtime';

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
