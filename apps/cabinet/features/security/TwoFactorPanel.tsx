'use client';

import { useState, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, ToneBadge } from '@broker/ui';
import {
  beginTwoFactorAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  type TwoFactorState,
} from '@/lib/two-factor-actions';
import { FormMessage } from '@/features/auth/FormMessage';
import { CodeInput } from './CodeInput';

function Submit({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' | 'danger-outline' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" variant={variant} loading={pending} disabled={pending}>
      {label}
    </Button>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('twoFactor');
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4" data-testid="recovery-codes">
      <p className="text-sm font-semibold">{t('recoveryTitle')}</p>
      <p className="text-xs text-secondary">{t('recoveryHint')}</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="compact"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? t('recoveryCopied') : t('recoveryCopy')}
        </Button>
        <Button
          type="button"
          size="compact"
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t('recoveryDownload')}
        </Button>
        <Button type="button" size="compact" onClick={onDone}>
          {t('recoveryDone')}
        </Button>
      </div>
    </div>
  );
}

function Setup({ onCodes, onCancel, initial }: { onCodes: (c: string[]) => void; onCancel: () => void; initial: TwoFactorState }) {
  const t = useTranslations('twoFactor');
  const [state, action] = useFormState<TwoFactorState, FormData>(async (prev, fd) => {
    const r = await confirmTwoFactorAction(prev, fd);
    if (r.recoveryCodes) onCodes(r.recoveryCodes);
    return r;
  }, initial);
  if (!state.setup) {
    return (
      <div className="space-y-3">
        <FormMessage error={state.error} />
        <Button type="button" size="compact" variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('scanQr')}</p>
        <div
          role="img"
          aria-label={t('qrLabel')}
          className="size-44 rounded-xl bg-white p-2 [&>svg]:size-full"
          dangerouslySetInnerHTML={{ __html: state.setup.qr }}
        />
        <p className="text-xs text-secondary">{t('manualKey')}</p>
        <code className="block break-all rounded-lg bg-sunken px-3 py-2 font-mono text-sm tracking-wider" data-testid="totp-secret">
          {state.setup.secret.replace(/(.{4})/g, '$1 ').trim()}
        </code>
      </div>
      <FormField label={t('enterCode')} htmlFor="tf-setup-code" required>
        <CodeInput id="tf-setup-code" recovery={false} invalid={!!state.error} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Submit label={t('confirm')} />
        <Button type="button" size="compact" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function CodeAction({
  id,
  title,
  hint,
  label,
  variant,
  recovery,
  run,
  onResult,
}: {
  id: string;
  title: string;
  hint: string;
  label: string;
  variant: 'secondary' | 'danger-outline';
  recovery: boolean;
  run: (prev: TwoFactorState, fd: FormData) => Promise<TwoFactorState>;
  onResult: (r: TwoFactorState) => void;
}) {
  const t = useTranslations('twoFactor');
  const [state, action] = useFormState<TwoFactorState, FormData>(async (prev, fd) => {
    const r = await run(prev, fd);
    onResult(r);
    return r;
  }, {});
  return (
    <form action={action} className="space-y-3 border-t border-border pt-4" noValidate>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-secondary">{hint}</p>
      </div>
      <FormMessage error={state.error} />
      <FormField label={recovery ? t('codeOrRecovery') : t('codeLabel')} htmlFor={id} required>
        <CodeInput id={id} recovery={recovery} invalid={!!state.error} />
      </FormField>
      <Submit label={label} variant={variant} />
    </form>
  );
}

export function TwoFactorPanel({
  enabled,
  enabledSince,
  recoveryLeft,
}: {
  enabled: boolean;
  enabledSince: string | null;
  recoveryLeft: number;
}) {
  const t = useTranslations('twoFactor');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [setup, setSetup] = useState<TwoFactorState | null>(null);
  const [notice, setNotice] = useState<'enabledOk' | 'disabledOk' | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  if (codes) {
    return (
      <div className="space-y-3">
        {notice ? <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">{t(notice)}</p> : null}
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            setNotice(null);
          }}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ToneBadge tone="neutral">{t('statusOff')}</ToneBadge>
        </div>
        {notice === 'disabledOk' ? (
          <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">{t('disabledOk')}</p>
        ) : null}
        {setup ? (
          <Setup
            initial={setup}
            onCancel={() => setSetup(null)}
            onCodes={(c) => {
              setSetup(null);
              setNotice('enabledOk');
              setCodes(c);
            }}
          />
        ) : (
          <>
            <p className="text-sm text-secondary">{t('intro')}</p>
            <FormMessage error={error} />
            <Button
              type="button"
              size="compact"
              loading={pending}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await beginTwoFactorAction();
                  setNotice(null);
                  if (r.setup) {
                    setError(undefined);
                    setSetup(r);
                  } else setError(r.error);
                })
              }
            >
              {t('enable')}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ToneBadge tone="positive">{t('statusOn')}</ToneBadge>
        {enabledSince ? <span className="text-secondary">{t('enabledSince', { date: enabledSince })}</span> : null}
      </div>
      <p className="text-xs text-secondary">{t('recoveryLeft', { count: recoveryLeft })}</p>
      <CodeAction
        id="tf-regen-code"
        title={t('regenerate')}
        hint={t('regenerateHint')}
        label={t('regenerate')}
        variant="secondary"
        recovery={false}
        run={regenerateRecoveryCodesAction}
        onResult={(r) => {
          if (r.recoveryCodes) setCodes(r.recoveryCodes);
        }}
      />
      <CodeAction
        id="tf-disable-code"
        title={t('disable')}
        hint={t('disableHint')}
        label={t('disable')}
        variant="danger-outline"
        recovery
        run={disableTwoFactorAction}
        onResult={(r) => {
          if (r.disabled) setNotice('disabledOk');
        }}
      />
    </div>
  );
}
