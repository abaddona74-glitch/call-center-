import type { ServerEvents, TicketParty } from '@cc/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ticketKeys } from '@/entities/ticket';
import { useRealtimeEvent } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon } from '@/shared/ui/legacy-icon';

// ---------------------------------------------------------------------------
// Sound (legacy WebAudio chimes, toggle persisted in localStorage)
// ---------------------------------------------------------------------------
const SOUND_KEY = 'ticket_sound_enabled';
const soundListeners = new Set<() => void>();
let audioCtx: AudioContext | null = null;

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false';
  } catch {
    return true;
  }
}

function ctx(): AudioContext | null {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

const NORMAL: Array<[number, number, number, number]> = [
  [523.25, 0, 0.18, 0.5],
  [783.99, 0.09, 0.22, 0.6],
  [1046.5, 0.18, 0.35, 0.65],
];
const URGENT: Array<[number, number, number, number]> = [
  [587.33, 0, 0.18, 0.6],
  [880, 0.08, 0.22, 0.7],
  [1174.66, 0.16, 0.3, 0.75],
  [659.25, 0.32, 0.18, 0.65],
  [987.77, 0.4, 0.24, 0.75],
  [1318.51, 0.48, 0.4, 0.8],
];

export function playChime(urgent = false, force = false): void {
  if (!force && !readSound()) return;
  const c = ctx();
  if (!c) return;
  const t0 = c.currentTime + 0.01;
  for (const [freq, at, dur, vol] of urgent ? URGENT : NORMAL) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = t0 + at;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/** Unlocks the AudioContext on the first user gesture (browsers block audio before that). */
function useAudioUnlock(): void {
  useEffect(() => {
    const unlock = () => ctx();
    const opts = { once: true, passive: true } as const;
    window.addEventListener('click', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    window.addEventListener('touchstart', unlock, opts);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);
}

/** `.tk-sound-toggle-btn` */
export function SoundToggle() {
  const { t } = useTranslation('ticket');
  const enabled = useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    readSound,
  );
  return (
    <button
      type="button"
      title={enabled ? t('sound.on') : t('sound.off')}
      aria-label={enabled ? t('sound.on') : t('sound.off')}
      aria-pressed={enabled}
      onClick={() => {
        try {
          localStorage.setItem(SOUND_KEY, String(!enabled));
        } catch {
          /* storage unavailable */
        }
        for (const l of soundListeners) l();
        if (!enabled) playChime(false, true);
      }}
      className={cn(
        'inline-flex size-[30px] items-center justify-center rounded-lg border p-0 transition-all duration-200',
        enabled
          ? 'border-white/12 bg-white/6 text-[#94a3b8] hover:border-[rgba(56,189,248,0.3)] hover:bg-[rgba(56,189,248,0.12)] hover:text-[#38bdf8]'
          : 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.12)] text-[#ef4444]',
      )}
    >
      <LegacyIcon name={enabled ? 'volume-high' : 'volume-cross'} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Title flash
// ---------------------------------------------------------------------------
let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashOriginal = '';

export function stopTitleFlash(): void {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
    document.title = flashOriginal;
  }
}

function startTitleFlash(text: string): void {
  if (flashTimer) return;
  flashOriginal = document.title;
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? `(🔔 ${text}) ${flashOriginal}` : flashOriginal;
  }, 900);
}

// ---------------------------------------------------------------------------
// Toast (legacy `.tk-toast`)
// ---------------------------------------------------------------------------
type Changed = ServerEvents['tickets.changed'];

function showTicketToast(e: Changed, forMe: boolean, t: TFunction<'ticket'>, onOpen: (id: number) => void): void {
  const badge = forMe ? (e.isUrgent ? t('toast.forMeUrgent') : t('toast.forMe')) : e.isUrgent ? t('toast.urgent') : t('toast.newTicket');
  toast.custom(
    (id) => (
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          toast.dismiss(id);
          stopTitleFlash();
          onOpen(e.id);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            toast.dismiss(id);
            onOpen(e.id);
          }
        }}
        className={cn(
          'flex w-[380px] max-w-[calc(100vw-48px)] cursor-pointer flex-col gap-2 rounded-[14px] border bg-[rgba(15,23,42,0.94)] px-4 py-3.5 text-left backdrop-blur-[16px]',
          e.isUrgent
            ? 'animate-[tkUrgentGlow_2s_ease-in-out_infinite] border-[rgba(245,158,11,0.6)] shadow-[0_16px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(245,158,11,0.3)]'
            : forMe
              ? 'border-[rgba(14,165,233,0.7)] shadow-[0_16px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(14,165,233,0.35)]'
              : 'border-[rgba(56,189,248,0.35)] shadow-[0_16px_36px_rgba(0,0,0,0.6),0_0_20px_rgba(56,189,248,0.18)]',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-[5px] rounded-md border px-2 py-[3px] text-[11px] font-bold tracking-[0.5px] uppercase',
              e.isUrgent
                ? 'border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.2)] text-[#fbbf24]'
                : 'border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.18)] text-[#38bdf8]',
            )}
          >
            {e.isUrgent ? <Icon name="flash" className="size-3" /> : !forMe && <Icon name="clipboard-text" className="size-3" />}
            {badge}
          </span>
          <button
            type="button"
            title={t('toast.close')}
            onClick={(ev) => {
              ev.stopPropagation();
              toast.dismiss(id);
            }}
            className="rounded p-0.5 text-[#94a3b8] transition-colors hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="flex gap-1.5 text-[13px] font-bold text-white">
          <span>#{e.code}</span>
          <span className="text-[11px] font-normal text-[#94a3b8]">{t('toast.from', { name: e.actor.label })}</span>
        </div>
        <div className="line-clamp-2 max-h-[52px] text-xs leading-[1.45] text-[#cbd5e1]">{e.preview || t('toast.defaultBody')}</div>
        <div className="mt-1 flex items-center justify-between border-t border-white/8 pt-2 text-[11px] text-[#94a3b8]">
          <span>
            {t('toast.to')}
            <b className="text-[#38bdf8]">{e.targetLabel ?? t('toast.toAll')}</b>
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-115">
            {t('toast.open')}
            <LegacyIcon name="export-3" className="size-3" />
          </span>
        </div>
      </div>
    ),
    { duration: e.isUrgent ? 18_000 : 9_000 },
  );
}

/**
 * Live board: refreshes lists/details on ticket events and, for new tickets addressed to
 * this user (receivers) or any new ticket (admins), plays the chime, shows the toast and
 * flashes the title when the tab is in the background. Own actions never notify.
 */
export function useTicketLive({
  meId,
  party,
  openTicketId,
  onOpen,
  onDeleted,
}: {
  meId: number;
  party: TicketParty;
  openTicketId: number | null;
  onOpen: (id: number) => void;
  onDeleted: (id: number) => void;
}): { arrived: Set<number>; clearArrived: (id: number) => void } {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const [arrived, setArrived] = useState<Set<number>>(new Set());
  useAudioUnlock();

  useEffect(() => {
    const stop = () => stopTitleFlash();
    window.addEventListener('focus', stop);
    window.addEventListener('click', stop);
    return () => {
      window.removeEventListener('focus', stop);
      window.removeEventListener('click', stop);
      stopTitleFlash();
    };
  }, []);

  useRealtimeEvent('tickets.changed', (e) => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(e.id) });
    if (e.actor.userId === meId) return;
    if (e.action === 'created') {
      const forMe = e.targetUserId === meId;
      const notify = party === 'admin' || (party === 'receiver' && (e.targetUserId === null || forMe));
      if (!notify) return;
      setArrived((s) => new Set(s).add(e.id));
      playChime(e.isUrgent);
      showTicketToast(e, forMe, t, onOpen);
      if (document.hidden || !document.hasFocus()) {
        startTitleFlash(forMe ? t('toast.flashForMe') : e.isUrgent ? t('toast.flashUrgent') : t('toast.flashNew'));
      }
    } else if (e.action === 'commented' && e.id === openTicketId) {
      playChime(false);
    }
  });

  useRealtimeEvent('tickets.deleted', (e) => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    queryClient.removeQueries({ queryKey: ticketKeys.detail(e.id) });
    onDeleted(e.id);
  });

  useRealtimeEvent('tickets.purged', () => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
  });

  const clearArrived = useCallback((id: number) => {
    setArrived((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  return { arrived, clearArrived };
}
