import { NextResponse } from 'next/server';
import { contactSchema } from '@/features/contacts/schema';
import { getLeadStore } from '@/lib/leads/store';
import { clientIp, isRateLimited } from '@/lib/rate-limit';

/** Форма обратной связи: локальная запись + outbox (ADR-018), как и register. */
export async function POST(request: Request) {
  const ip = clientIp(request);

  if (isRateLimited(`contact:${ip}`)) {
    return NextResponse.json({ ok: false, error: 'rateLimited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalidRequest' }, { status: 400 });
  }

  // Honeypot — боту отвечаем «успехом»
  if (typeof body === 'object' && body !== null && (body as Record<string, unknown>).website) {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return NextResponse.json({ ok: false, fieldErrors }, { status: 422 });
  }

  const rawLocale = (body as Record<string, unknown>).locale;

  const result = await getLeadStore().createLead({
    kind: 'contact',
    name: parsed.data.name,
    email: parsed.data.email,
    topic: parsed.data.topic,
    message: parsed.data.message,
    locale: rawLocale === 'en' ? 'en' : 'ru',
  });

  if (!result.ok) {
    // Для contact дубликатов нет по схеме БД; ветка на будущее
    return NextResponse.json({ ok: false, error: 'generic' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ticketId: result.leadId }, { status: 201 });
}
