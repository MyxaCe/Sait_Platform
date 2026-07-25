'use client';

import { useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormField, Select } from '@broker/ui';
import { uploadDocumentAction, type ActionState } from '@/lib/actions';
import { FormMessage, useFieldError } from '@/features/auth/FormMessage';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

export function UploadForm() {
  const t = useTranslations('documents');
  const fieldError = useFieldError();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<ActionState, FormData>(
    async (prev: ActionState, formData: FormData) => {
      const result = await uploadDocumentAction(prev, formData);
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
          {t('uploaded')}
        </p>
      )}

      <FormField label={t('kind')} htmlFor="kind">
        <Select id="kind" name="kind" defaultValue="identity">
          <option value="identity">{t('kinds.identity')}</option>
          <option value="address">{t('kinds.address')}</option>
          <option value="other">{t('kinds.other')}</option>
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
        <SubmitButton label={t('upload')} />
      </div>
    </form>
  );
}
