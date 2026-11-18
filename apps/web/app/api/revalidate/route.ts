import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ALLOWED_TAG_PATTERN,
  claimDeferredInvalidate,
  completeDeferredInvalidate,
  isDuplicateEvent,
  shouldInvalidate,
  verifySignature,
} from '@/lib/revalidate';

const bodySchema = z.object({
  event_id: z.string().uuid(),
  occurred_at: z.string().optional(),
  tags: z.array(z.string().regex(ALLOWED_TAG_PATTERN)).min(1).max(20),
});

export async function POST(request: Request) {
  const secret = process.env.CMS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-signature'), secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (isDuplicateEvent(parsed.event_id)) {
    return NextResponse.json({ deduplicated: true }, { status: 202 });
  }

  const applied: string[] = [];
  const deferred: string[] = [];
  for (const tag of new Set(parsed.tags)) {
    if (shouldInvalidate(tag)) {
      revalidateTag(tag);
      applied.push(tag);
      continue;
    }
    const delay = claimDeferredInvalidate(tag);
    if (delay !== null) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      revalidateTag(tag);
      completeDeferredInvalidate(tag);
    }
    deferred.push(tag);
  }

  console.info(
    `[revalidate] event=${parsed.event_id} applied=[${applied.join(',')}] deferred=[${deferred.join(',')}]`,
  );
  return NextResponse.json({ applied, deferred }, { status: 202 });
}
