import { NextResponse } from 'next/server';
import { buildFingerprint, configFingerprint, instanceIdentity } from '@/lib/instance';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'site-web',
    instance: instanceIdentity(),
    config: configFingerprint(),
    configBuild: buildFingerprint(),
    time: new Date().toISOString(),
  });
}
