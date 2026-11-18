import type { ServerEvents, TicketChangeAction } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ticketContextQuery, ticketKeys, ticketUnreadQuery } from '@/entities/ticket';
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
  const enabled = useSyncExternalStore((l) => {
    soundListeners.add(l);
    return () => soundListeners.delete(l);
  }, readSound);
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
          ? 'border-tint/12 bg-tint/6 text-mute hover:border-[rgba(56,189,248,0.3)] hover:bg-[rgba(56,189,248,0.12)] hover:text-info'
          : 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.12)] text-shade-[#ef4444]',
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

function showTicketToast(e: Changed, t: TFunction<'ticket'>, onOpen: (id: number) => void): void {
  const badge =
    e.action === 'forwarded'
      ? t('toast.forwarded')
      : e.action === 'released'
        ? t('toast.released')
        : t('toast.newInRegion');
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
        className="flex w-[380px] max-w-[calc(100vw-48px)] cursor-pointer flex-col gap-2 rounded-[14px] border border-[rgba(56,189,248,0.35)] bg-glass/94 px-4 py-3.5 text-left shadow-[0_16px_36px_color-mix(in_srgb,var(--shadow-color)_60%,transparent),0_0_20px_rgba(56,189,248,0.18)] backdrop-blur-[16px]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-[5px] rounded-md border border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.18)] px-2 py-[3px] text-[11px] font-bold tracking-[0.5px] text-info uppercase">
            <Icon name="clipboard-text" className="size-3" />
            {badge}
          </span>
          <button
            type="button"
            title={t('toast.close')}
            onClick={(ev) => {
              ev.stopPropagation();
              toast.dismiss(id);
            }}
            className="rounded p-0.5 text-mute transition-colors hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="flex items-center justify-between gap-1.5 text-[13px] font-bold text-ink">
          <span>#{e.code}</span>
          <span className="text-[11px] font-normal text-mute">{e.actor.label}</span>
        </div>
        <div className="mt-1 flex items-center justify-end border-t border-tint/8 pt-2 text-[11px] text-mute">
          <span className="inline-flex items-center gap-1 rounded-md bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-115">
            {t('toast.open')}
            <LegacyIcon name="export-3" className="size-3" />
          </span>
        </div>
      </div>
    ),
    { duration: 12_000 },
  );
}

/** A ticket lands in a region queue: opened there, forwarded there, or released back by its executive. */
const ARRIVALS: ReadonlySet<TicketChangeAction> = new Set<TicketChangeAction>(['created', 'forwarded', 'released']);

/**
 * Keeps ticket lists/details fresh from WS events on the tickets screens and tracks tickets that just
 * arrived (highlighted until opened). Sound/toasts are played once, globally, by `TicketAlerts`.
 */
export function useTicketLive({
  openTicketId,
  onRevoked,
}: {
  openTicketId: number | null;
  onRevoked: (id: number) => void;
}): { arrived: Set<number>; clearArrived: (id: number) => void } {
  const queryClient = useQueryClient();
  const [arrived, setArrived] = useState<Set<number>>(new Set());

  useRealtimeEvent('tickets.changed', (e) => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(e.id) });
    if (ARRIVALS.has(e.action) && e.id !== openTicketId) setArrived((s) => new Set(s).add(e.id));
  });

  useRealtimeEvent('tickets.revoked', (e) => {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    queryClient.removeQueries({ queryKey: ticketKeys.detail(e.id) });
    onRevoked(e.id);
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

/**
 * Header element (one line in the app shell): for executives (`regionAlerts`), the unread counter of new
 * tickets in their regions + chime, toast and title flash when a ticket arrives or is released back to the
 * queue — on every page. Nothing for other roles (the superuser and observers see every region).
 */
export function TicketAlerts({ meId }: { meId: number }) {
  const { t } = useTranslation('ticket');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ctx = useQuery(ticketContextQuery);
  const alerts = Boolean(ctx.data?.capabilities.regionAlerts);
  const unread = useQuery({ ...ticketUnreadQuery, enabled: alerts });
  useAudioUnlock();

  useEffect(() => {
    const stop = () => stopTitleFlash();
    window.addEventListener('focus', stop);
    return () => {
      window.removeEventListener('focus', stop);
      stopTitleFlash();
    };
  }, []);

  useRealtimeEvent('tickets.unread', (e) => queryClient.setQueryData(ticketKeys.unread, { count: e.count }));
  useRealtimeEvent('tickets.changed', (e) => {
    if (!alerts || e.actor.userId === meId || e.status !== 'new' || !ARRIVALS.has(e.action)) return;
    playChime(false);
    showTicketToast(e, t, (id) => void navigate({ to: '/tickets', search: { view: 'queue', open: id } }));
    if (document.hidden || !document.hasFocus()) startTitleFlash(t('toast.flash'));
  });

  if (!alerts) return null;
  const count = unread.data?.count ?? ctx.data?.unread ?? 0;
  return (
    <button
      type="button"
      title={t('unreadTitle')}
      onClick={() => void navigate({ to: '/tickets', search: { view: 'queue' } })}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors',
        count > 0
          ? 'animate-[tkNewGlow_2.2s_ease-in-out_infinite] border-[rgba(56,189,248,0.55)] bg-[rgba(56,189,248,0.18)] text-info'
          : 'border-tint/10 bg-tint/5 text-muted-foreground',
      )}
    >
      <Icon name="clipboard-text" className="size-3.5" />
      {t('unread', { n: count })}
    </button>
  );
}
