import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SkipToast,
  StudioPlayer,
  audioPlayer,
  callRecordingQuery,
  callRecordingStreamUrl,
  useAudioPlayer,
} from '@/entities/recording';
import { isHttpError } from '@/shared/api';
import { Icon } from '@/shared/ui/icon';

/**
 * The Studio player for one call, right where it is shown (call details dialog), so the recording can be
 * listened to, sought, skipped and sped up without going to Audio Explorer. Opening it loads the call's
 * recording into the shared player and starts it (same lookup as «Tinglash»: by the exact uniqueid); when this
 * call is already loaded (e.g. «Tinglash» was pressed first) it keeps its position and state.
 * Unmounting (the dialog closes) pauses it; the row button then offers «Davom ettirish».
 */
export function CallRecordingStudio({ uniqueid, label }: { uniqueid: string; label: string }) {
  const { t } = useTranslation('recording');
  const queryClient = useQueryClient();
  const player = useAudioPlayer();
  const key = `call:${uniqueid}`;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (audioPlayer.getState().track?.key === key) return;
    let cancelled = false;
    queryClient
      .fetchQuery(callRecordingQuery(uniqueid))
      .then((rec) => {
        if (cancelled) return;
        audioPlayer.play({
          key,
          title: label,
          src: callRecordingStreamUrl(uniqueid),
          downloadUrl: callRecordingStreamUrl(uniqueid, true),
          size: rec.file.size,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isHttpError(err, 403)) setError(t('call.forbidden'));
        else if (isHttpError(err, 404)) setError(t('call.notFound'));
        else setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // The label only titles the track: a new one must not reload the recording.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, uniqueid, queryClient, t]);

  // Pause on a real unmount only: the check waits a tick, so StrictMode's dev remount doesn't stop playback.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current && audioPlayer.getState().track?.key === key) audioPlayer.pause();
      }, 0);
    };
  }, [key]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <Icon name="close-circle" className="size-4 shrink-0" />
        {error}
      </div>
    );
  }
  if (player.track?.key !== key) {
    return (
      <div className="flex h-[120px] items-center justify-center gap-2 rounded-[18px] border border-tint/8 bg-tint/[0.02] text-sm text-muted-foreground">
        <Icon name="timer" className="size-4 animate-pulse" />
        {t('player.loading')}
      </div>
    );
  }
  return (
    <>
      <StudioPlayer embedded />
      <SkipToast />
    </>
  );
}
