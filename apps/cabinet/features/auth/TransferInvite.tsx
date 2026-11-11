import { getTranslations } from 'next-intl/server';
import { inspectInvite } from '@broker/transfer';
import type { Queryable } from '@broker/money';
import { getPool } from '@/lib/db';
import type { RegisterPrefill } from './RegisterForm';

/**
 * Регистрация по приглашению перевода с другой платформы группы (ветка
 * client-transfer). Ссылка из письма платформы-цели: `/register?invite=…`.
 * Поля формы предзаполняются ТОЛЬКО тем, что передано с согласия клиента;
 * клиент может их исправить и регистрируется сам. Сбой базы — обычная
 * регистрация без приглашения (не отказ).
 */

export type InviteState =
  | { state: 'none' }
  | { state: 'ok'; prefill: RegisterPrefill; number: string; sourceName: string }
  | { state: 'invalid' | 'expired' | 'used' | 'revoked' };

export async function loadInvite(token: string | undefined): Promise<InviteState> {
  if (!token) return { state: 'none' };
  try {
    const r = await inspectInvite(getPool() as unknown as Queryable, token);
    if (!r.ok) return { state: r.reason };
    return {
      state: 'ok',
      number: r.prefill.number,
      sourceName: r.prefill.sourceName,
      prefill: {
        invite: token,
        firstName: r.prefill.firstName,
        lastName: r.prefill.lastName,
        email: r.prefill.email,
        country: r.prefill.country ?? '',
      },
    };
  } catch (error) {
    console.error('[register] приглашение не прочитано — обычная регистрация', (error as Error).message);
    return { state: 'none' };
  }
}

export async function InviteNotice({ invite }: { invite: InviteState }) {
  if (invite.state === 'none') return null;
  const t = await getTranslations('platformTransfer');
  if (invite.state !== 'ok') {
    const key = invite.state === 'expired' ? 'inviteExpired' : invite.state === 'revoked' ? 'inviteRevoked' : 'inviteInvalid';
    return (
      <p role="status" className="mb-5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-primary">
        {t(key)}
      </p>
    );
  }
  return (
    <section aria-label={t('inviteTitle', { number: invite.number })} className="mb-5 rounded-xl border border-accent/40 bg-accent/[0.07] px-4 py-3 text-sm">
      <p className="font-semibold text-primary">{t('inviteTitle', { number: invite.number })}</p>
      <p className="mt-1 text-secondary">{t('inviteBody', { source: invite.sourceName })}</p>
      <p className="mt-1 text-secondary">{t('inviteFunds', { source: invite.sourceName })}</p>
    </section>
  );
}
