import { NextResponse } from 'next/server';
import { twoFactorKey } from '@broker/support';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'admin',
      sessionSecret: process.env.ADMIN_SESSION_SECRET ? 'set' : 'unset',
      totpKey: twoFactorKey(process.env.ADMIN_TOTP_KEY) ? 'set' : 'unset',
      totpRequireEncrypted: process.env.ADMIN_TOTP_REQUIRE_ENCRYPTED === '1',
      time: new Date().toISOString(),
    },
    { status: 200 },
  );
}
