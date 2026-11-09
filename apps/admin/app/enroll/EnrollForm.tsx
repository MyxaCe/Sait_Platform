'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import QRCode from 'qrcode';
import { Button, Callout, CopyButton, Input, Skeleton } from '@broker/ui';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  type EnrollConfirmState,
  type EnrollStartResult,
} from '@/lib/totp/actions';

/**
 * Клиентская форма регистрации TOTP. На монтировании просит сервер завести
 * секрет (`beginTotpEnrollment`) — секрет живёт в httpOnly-тикете, сюда
 * приходят только provisioning-URI и ручной ключ для сканирования. QR рисуется
 * здесь же, в браузере, из этого URI (никуда не отправляется). Затем оператор
 * вводит код; `confirmTotpEnrollment` сверяет его и при успехе сохраняет
 * секрет и уводит внутрь (redirect из action).
 */

const MESSAGES: Record<string, string> = {
  invalidCode: 'Код не подошёл. Проверьте время на устройстве и попробуйте снова.',
  expired: 'Время настройки истекло. Обновите страницу и начните заново.',
  alreadyEnrolled: 'Второй фактор уже настроен.',
};

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="compact" className="h-10 w-full" loading={pending} disabled={pending}>
      Подтвердить и включить
    </Button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-primary/[0.07] text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-primary pt-0.5 text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** Ключ группами по 4 — так его легче перепечатать вручную. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function EnrollForm() {
  const [provision, setProvision] = useState<EnrollStartResult | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [state, formAction] = useFormState<EnrollConfirmState, FormData>(confirmTotpEnrollment, {});

  useEffect(() => {
    let active = true;
    beginTotpEnrollment()
      .then((result) => {
        if (!active) return;
        if ('error' in result) setStartError(result.error);
        else setProvision(result);
      })
      .catch(() => active && setStartError('expired'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!provision) return;
    // QR — функциональный код для камеры: строго чёрный по белому (не цвета
    // палитры), иначе часть сканеров его не прочтёт.
    QRCode.toString(provision.uri, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [provision]);

  if (startError) {
    return (
      <Callout tone="negative" title="Не удалось начать настройку">
        {MESSAGES[startError] ?? 'Обновите страницу и попробуйте снова.'}
      </Callout>
    );
  }

  return (
    <ol className="space-y-6">
      <Step n={1} title="Установите приложение-аутентификатор">
        <p className="text-secondary text-[13px]">
          Google Authenticator, 1Password, Aegis или любое с поддержкой TOTP.
        </p>
      </Step>

      <Step n={2} title="Добавьте аккаунт: отсканируйте QR-код">
        {provision ? (
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              {qr ? (
                <div
                  role="img"
                  aria-label="QR-код для приложения-аутентификатора"
                  className="border-border size-[148px] shrink-0 overflow-hidden rounded-md border [&>svg]:size-full"
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
              ) : (
                <Skeleton className="size-[148px] shrink-0" />
              )}
              <div className="min-w-0 space-y-1.5">
                <p className="text-muted text-xs">Или введите ключ вручную</p>
                <p className="flex items-start gap-1.5">
                  <span className="text-primary select-all font-mono text-[13px] leading-5 tracking-wide">
                    {grouped(provision.secret)}
                  </span>
                  <CopyButton value={provision.secret} label="ключ" />
                </p>
                <p className="text-muted text-xs">Тип — по времени, 6 цифр, 30 секунд.</p>
              </div>
            </div>
            <details className="group">
              <summary className="text-muted hover:text-primary cursor-pointer select-none text-xs">
                Строка otpauth:// для менеджера паролей
              </summary>
              <code className="border-border bg-sunken text-secondary mt-2 block overflow-x-auto whitespace-nowrap rounded-md border px-3 py-2 font-mono text-xs">
                {provision.uri}
              </code>
            </details>
          </div>
        ) : (
          <div className="flex items-start gap-4" aria-busy>
            <Skeleton className="size-[148px] shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-full" />
              <p className="text-muted text-xs">Готовим секретный ключ…</p>
            </div>
          </div>
        )}
      </Step>

      <Step n={3} title="Введите код из приложения">
        <form action={formAction} className="flex flex-col gap-3" noValidate>
          {state.error ? (
            <Callout tone="negative">
              {MESSAGES[state.error] ?? 'Не удалось включить второй фактор.'}
            </Callout>
          ) : null}
          <Input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Код из приложения"
            maxLength={6}
            controlSize="compact"
            placeholder="000 000"
            disabled={!provision}
            className="h-11 text-center font-mono text-lg tracking-[0.4em]"
          />
          <ConfirmButton />
        </form>
      </Step>
    </ol>
  );
}
