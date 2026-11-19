import { countAwaitingOperator } from '@broker/support';
import { getPool } from '../db';
import { supportActor } from './runtime';

export async function supportAttentionForSession(): Promise<number | null> {
  const actor = await supportActor();
  if (!actor) return null;
  try {
    return await countAwaitingOperator(getPool(), actor);
  } catch {
    return null;
  }
}
