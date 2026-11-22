import { fmtDateTime } from '../ui/format';
import type { LivenessTask, SelfieCapture } from './queries';

export const PROVIDER_LABELS: Record<string, string> = {
  manual: 'ручная проверка оператором',
};

export function livenessTaskLabel(task: LivenessTask | undefined): string {
  switch (task?.kind) {
    case 'face_front':
      return 'Лицо прямо в камеру';
    case 'turn_left':
      return 'Поворот головы влево (для клиента)';
    case 'turn_right':
      return 'Поворот головы вправо (для клиента)';
    case 'show_fingers':
      return `Поднять пальцев: ${task.count ?? '?'}`;
    case 'hold_document':
      return 'Документ рядом с лицом';
    default:
      return 'Задание не распознано';
  }
}

export interface SelfieCaptureView {
  code: string;
  provider: string;
  issuedText: string;
  expiresText: string;
  usedText: string | null;
  userAgent: string | null;
  tasks: string[];
  frames: { index: number; task: string; capturedText: string; offsetText: string }[];
}

export function toSelfieCaptureView(capture: SelfieCapture): SelfieCaptureView {
  const issued = new Date(capture.issuedAt).getTime();
  return {
    code: capture.code,
    provider: PROVIDER_LABELS[capture.provider] ?? capture.provider,
    issuedText: fmtDateTime(capture.issuedAt),
    expiresText: fmtDateTime(capture.expiresAt),
    usedText: capture.usedAt ? fmtDateTime(capture.usedAt) : null,
    userAgent: capture.userAgent,
    tasks: capture.tasks.map(livenessTaskLabel),
    frames: capture.frames.map((f) => ({
      index: f.index,
      task: livenessTaskLabel(capture.tasks[f.index]),
      capturedText: fmtDateTime(f.capturedAt),
      offsetText: `+${Math.max(0, Math.round((new Date(f.capturedAt).getTime() - issued) / 1000))} с`,
    })),
  };
}
