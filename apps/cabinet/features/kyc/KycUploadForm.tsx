'use client';

import { useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField } from '@broker/ui';
import { submitKycDocumentAction } from '@/lib/kyc-actions';
import type { KycDocKind } from '@/lib/kyc-kinds';
import type { ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from '@/features/auth/FormMessage';

export type UploadKycKind = Exclude<KycDocKind, 'selfie_liveness'>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function KycUploadForm({ kind }: { kind: UploadKycKind }) {
  const t = useTranslations('kyc');
  const fieldError = useFieldError();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<ActionState, FormData>(
    async (prev: ActionState, formData: FormData) => {
      const result = await submitKycDocumentAction(prev, formData);
      if (result.ok) formRef.current?.reset();
      return result;
    },
    {},
  );
  const inputId = `file-${kind}`;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      {state.ok && (
        <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">
          {t('submitted')}
        </p>
      )}

      <input type="hidden" name="kind" value={kind} />

      <FormField label={t('file')} htmlFor={inputId} required error={fieldError(state.fieldErrors?.file)}>
        <input
          id={inputId}
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="block w-full cursor-pointer rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-secondary file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-accent"
        />
      </FormField>

      <div>
        <SubmitButton label={t('submit')} />
      </div>
    </form>
  );
}
