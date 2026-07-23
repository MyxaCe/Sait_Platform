import { NextResponse } from 'next/server';
import { contactSchema } from '@/features/contacts/schema';
import { clientIp, isRateLimited } from '@/lib/rate-limit';

/** BFF-эндпоинт формы обратной связи. Паттерн тот же, что у /api/leads/register. */
export async function POST(request: Request) {
  const ip = clientIp(request);

  if (isRateLimited(`contact:${ip}`)) {
    // error — ключ из namespace `validation`, клиент переводит при отображении
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

  // TODO(CRM): создание тикета в хелпдеске / отправка в CRM
  await new Promise((resolve) => setTimeout(resolve, 300));

  return NextResponse.json({ ok: true, ticketId: crypto.randomUUID() }, { status: 201 });
}
