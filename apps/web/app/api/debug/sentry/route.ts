export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.ALLOW_SENTRY_TEST !== '1') {
    return new Response('not found', { status: 404 });
  }
  throw new Error(
    'GlitchTip smoke: leak test-user@example.com phone +7 900 123-45-67 card 4111 1111 1111 1111',
  );
}
