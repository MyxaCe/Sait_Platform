'use client';

import { useState } from 'react';
import { Select } from '@broker/ui';
import { setWithdrawModeAction } from '@/lib/crypto/actions';
import { WITHDRAW_MODE_HINT, WITHDRAW_MODE_LABEL } from '@/lib/crypto/labels';
import { ActionForm } from '../_money/ActionForm';

const MODES = ['manual', 'auto', 'stop'] as const;

export function WithdrawModeForm({ current }: { current: string }) {
  const [mode, setMode] = useState<string>(current);
  return (
    <ActionForm
      action={setWithdrawModeAction}
      submitLabel="Сменить режим вывода"
      okText="Режим вывода сменён, запись в журнале."
      extraValid={mode !== current}
      disarmOn={mode}
      reasonPlaceholder="Почему меняется режим вывода для всей платформы"
      confirm={{
        tone: mode === 'stop' ? 'danger' : 'primary',
        title: `Режим вывода: «${WITHDRAW_MODE_LABEL[current] ?? current}» → «${WITHDRAW_MODE_LABEL[mode] ?? mode}»?`,
        consequence: WITHDRAW_MODE_HINT[mode] ?? '',
        confirmLabel: 'Да, сменить режим',
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-muted block text-xs">Режим вывода для всей платформы</span>
        <Select controlSize="compact" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="w-56">
          {MODES.map((m) => (
            <option key={m} value={m}>
              {WITHDRAW_MODE_LABEL[m]}
              {m === current ? ' (сейчас)' : ''}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-muted -mt-1 text-xs">{WITHDRAW_MODE_HINT[mode]}</p>
    </ActionForm>
  );
}
