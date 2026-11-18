import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { audioPlayer, callRecordingQuery, callRecordingStreamUrl, useAudioPlayer } from '@/entities/recording';
import { isHttpError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

/**
 * Inline "Tinglash / To'xtatish / Davom ettirish" button for call rows (history, dashboard).
 * Finds the call's recording by its exact uniqueid (no guessing by caller/duration) and plays it
 * in the shared player; the row state follows the player, so labels never go stale.
 */
export function CallRecordingButton({ uniqueid, label, disabled }: { uniqueid: string | null; label: string; disabled?: boolean }) {
  const { t } = useTranslation('recording');
  const queryClient = useQueryClient();
  const player = useAudioPlayer();
  const [searching, setSearching] = useState(false);
  const key = `call:${uniqueid}`;
  const isMine = player.track?.key === key;
  const playing = isMine && (player.status === 'playing' || player.status === 'loading');
  const paused = isMine && (player.status === 'paused' || player.status === 'ended');

  const base =
    'inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border px-[11px] py-[5px] text-xs leading-[1.4] font-semibold transition-all duration-150';

  if (!uniqueid || disabled) {
    return (
      <button type="button" disabled title={t('call.noneTitle')} className={cn(base, 'cursor-not-allowed border-border text-foreground opacity-45')}>
        <Icon name="close-circle" className="size-3" />
        {t('call.none')}
      </button>
    );
  }

  const onClick = async () => {
    if (isMine && (playing || paused)) {
      audioPlayer.toggle();
      return;
    }
    setSearching(true);
    try {
      const rec = await queryClient.fetchQuery(callRecordingQuery(uniqueid));
      audioPlayer.play({
        key,
        title: label,
        src: callRecordingStreamUrl(uniqueid),
        downloadUrl: callRecordingStreamUrl(uniqueid, true),
        size: rec.file.size,
      });
    } catch (err) {
      if (isHttpError(err, 403)) toast.error(t('call.forbidden'));
      else if (isHttpError(err, 404)) toast.error(t('call.notFound'));
      else toast.error((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <button
      type="button"
      disabled={searching}
      onClick={() => void onClick()}
      title={playing ? t('call.pauseTitle') : paused ? t('call.resumeTitle') : t('call.listenTitle')}
      className={cn(
        base,
        'border-[#6c8cff] bg-[#6c8cff] text-white hover:brightness-112 disabled:opacity-70',
        playing && 'animate-[ccAudioPulse_1.4s_infinite] border-[#10b981] bg-[#10b981]',
      )}
    >
      <Icon name={searching ? 'timer' : playing ? 'pause' : 'play'} className="size-3" />
      {searching ? t('call.searching') : playing ? t('call.pause') : paused ? t('call.resume') : t('call.listen')}
    </button>
  );
}
