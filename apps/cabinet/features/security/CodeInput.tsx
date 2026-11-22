'use client';

import { Input } from '@broker/ui';

export function CodeInput({
  id,
  invalid,
  recovery = true,
  autoFocus,
  describedBy,
}: {
  id: string;
  invalid?: boolean;
  recovery?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  return (
    <Input
      id={id}
      name="code"
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      maxLength={recovery ? 16 : 6}
      placeholder="123456"
      className="max-w-[14rem] font-mono tracking-widest"
      invalid={invalid}
      autoFocus={autoFocus}
      aria-describedby={describedBy}
    />
  );
}
