import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { audioPlayer, callRecordingQuery, callRecordingStreamUrl, useAudioPlayer } from '@/entities/recording';
import { isHttpError } from '@/shared/api';
import { useApiScope } from '@/shared/lib/api-scope';

/**
 * "Play this call's recording from second N" in the shared player. Loads the recording first when the player holds
 * something else (same lookup as the «Tinglash» button: by the exact call id), then seeks and plays.
 * `position` is the playback position when this call is the one loaded, otherwise null.
 */
export function useRecordingSeek(callId: string, title: string) {
  const { t } = useTranslation('recording');
  const queryClient = useQueryClient();
  const player = useAudioPlayer();
  const scope = useApiScope();
  const key = `call:${callId}`;
  const loaded = player.track?.key === key && player.status !== 'error';

  const seek = async (seconds: number) => {
    if (loaded) {
      audioPlayer.seek(seconds);
      if (player.status === 'paused' || player.status === 'ended') audioPlayer.toggle();
      return;
    }
    try {
      const rec = await queryClient.fetchQuery(callRecordingQuery(callId, scope));
      audioPlayer.play({
        key,
        title,
        src: callRecordingStreamUrl(callId, false, scope),
        downloadUrl: callRecordingStreamUrl(callId, true, scope),
        size: rec.file.size,
      });
      audioPlayer.seek(seconds);
    } catch (err) {
      if (isHttpError(err, 403)) toast.error(t('call.forbidden'));
      else if (isHttpError(err, 404)) toast.error(t('call.notFound'));
      else toast.error((err as Error).message);
    }
  };

  return { seek, position: loaded ? player.currentTime : null };
}
