import { NextResponse } from 'next/server';
import { registerLeadSchema } from '@/features/registration/schema';
import { clientIp, isRateLimited } from '@/lib/rate-limit';

/**
 * BFF-эндпоинт заявки на открытие счёта.
 * Браузер никогда не ходит в CRM напрямую: здесь — повторная валидация
 * той же Zod-схемой, honeypot, rate-limit, и только потом проксирование
 * в CRM с серверным API-ключом (пока — мок).
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

  // Мок серверной бизнес-ошибки — для проверки маппинга ошибок в поля формы.
  // При интеграции с CRM здесь будет реальный ответ бэкенда.
  if (parsed.data.email.toLowerCase() === 'exists@example.com') {
    return NextResponse.json(
      { ok: false, fieldErrors: { email: 'emailExists' } },
      { status: 409 },
    );
  }

  // TODO(CRM): POST https://crm.internal/v1/leads с CRM_API_KEY из env
  await new Promise((resolve) => setTimeout(resolve, 400));

  return NextResponse.json({ ok: true, leadId: crypto.randomUUID() }, { status: 201 });
}
