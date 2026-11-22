'use client';

import { useState } from 'react';
import { Button } from '@broker/ui';
import type { VideoRef } from '@broker/api-client';
import { StreamFacade } from './StreamFacade';

export interface RecordingButtonProps {
  recording: Pick<VideoRef, 'provider' | 'videoId'>;
  title: string;
  label: string;
}

export function RecordingButton({ recording, title, label }: RecordingButtonProps) {
  const [open, setOpen] = useState(false);

  if (open) {
    return <StreamFacade provider={recording.provider} videoId={recording.videoId} title={title} startActive />;
  }
  return (
    <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
      {label}
    </Button>
  );
}
