/**
 * Диагностическая ручка проверки GlitchTip: бросает серверную ошибку с
 * «утечкой» email/телефона в сообщении — чтобы убедиться, что событие
 * доезжает И что PII-скраббинг его вычистил. Выключена по умолчанию,
 * включается только env ALLOW_SENTRY_TEST=1 (тестовый контур).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.ALLOW_SENTRY_TEST !== '1') {
    return new Response('not found', { status: 404 });
  }
  throw new Error(
    'GlitchTip smoke: leak test-user@example.com phone +7 900 123-45-67 card 4111 1111 1111 1111',
  );
}
