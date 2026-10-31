'use client';

import { useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, Select } from '@broker/ui';
import { submitKycDocumentAction } from '@/lib/kyc-actions';
import { KYC_DOC_KINDS } from '@/lib/kyc-kinds';
import type { ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from '@/features/auth/FormMessage';

/**
 * Форма подачи KYC-документа клиентом (CAB-KYC). Стиль повторяет
 * `features/documents/UploadForm`, но экшен кладёт файл в объектное хранилище
 * и ставит клиента в очередь проверки (`pending`). Виды документа — закрытый
 * перечень схемы (`KYC_DOC_KINDS`).
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function KycUploadForm() {
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

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage error={state.error} />
      {state.ok && (
        <p className="rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm text-positive">
          {t('submitted')}
        </p>
      )}

      <FormField label={t('kind')} htmlFor="kind">
        <Select id="kind" name="kind" defaultValue={KYC_DOC_KINDS[0]}>
          {KYC_DOC_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}` as never)}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={t('file')} htmlFor="file" required error={fieldError(state.fieldErrors?.file)}>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="block w-full cursor-pointer rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-secondary file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-base"
        />
      </FormField>

      <div>
        <SubmitButton label={t('submit')} />
      </div>
    </form>
  );
}
