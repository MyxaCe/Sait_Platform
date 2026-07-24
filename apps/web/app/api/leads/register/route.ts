import { NextResponse } from 'next/server';
import { registerLeadSchema } from '@/features/registration/schema';
import { getLeadStore } from '@/lib/leads/store';
import { clientIp, isRateLimited } from '@/lib/rate-limit';

/**
 * Заявка на открытие счёта (ADR-018): пишется ЛОКАЛЬНО (лид + outbox
 * в одной транзакции), клиент получает 201 немедленно. CRM узнаёт о лиде
 * асинхронно через событие lead.submitted — синхронных вызовов CRM
 * на пути клиента нет (золотое правило платформы).
 */
export async function POST(request: Request) {
  const ip = clientIp(request);

  if (isRateLimited(`register:${ip}`)) {
    // error — ключ из namespace `validation`, клиент переводит при отображении
    return NextResponse.json({ ok: false, error: 'rateLimited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalidRequest' }, { status: 400 });
  }

  // Honeypot: скрытое поле "website" заполняют только боты.
  // Отвечаем «успехом», чтобы бот не понял, что отфильтрован.
  if (typeof body === 'object' && body !== null && (body as Record<string, unknown>).website) {
    return NextResponse.json({ ok: true, leadId: 'accepted' }, { status: 201 });
  }

  const parsed = registerLeadSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return NextResponse.json({ ok: false, fieldErrors }, { status: 422 });
  }

  const rawLocale = (body as Record<string, unknown>).locale;
  const { agreeTerms: _agreeTerms, ...lead } = parsed.data;

  const result = await getLeadStore().createLead({
    kind: 'account-opening',
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    country: lead.country,
    accountType: lead.accountType,
    locale: rawLocale === 'en' ? 'en' : 'ru',
  });

  if (!result.ok) {
    // Дубликат — по НАШЕЙ БД (сайт — source of truth по клиентам брокера)
    return NextResponse.json(
      { ok: false, fieldErrors: { email: 'emailExists' } },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, leadId: result.leadId }, { status: 201 });
}
