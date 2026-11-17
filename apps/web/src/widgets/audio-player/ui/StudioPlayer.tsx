import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WAVEFORM_BARS, audioPlayer, formatBytes, formatDuration, makeWaveform, useAudioPlayer } from '@/entities/recording';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { LegacyIcon, PlayGlyph } from '@/shared/ui/legacy-icon';
import './studio-player.css';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
const CANVAS_HEIGHT = 150;

/**
 * The legacy "Studio" player card (shown while a recording is loaded). Renders the shared
 * audio player state; the waveform is the legacy synthetic one (seeded per file).
 */
export const StudioPlayer = forwardRef<HTMLElement>(function StudioPlayer(_, ref) {
  const { t } = useTranslation('recording');
  const s = useAudioPlayer();
  const track = s.track;
  if (!track) return null;

  const isPlaying = s.status === 'playing';
  let status = t('player.playing');
  let statusIsError = false;
  if (s.status === 'error') {
    status = s.error === 'play_failed' ? t('player.playFailed') : t('player.openFailed');
    statusIsError = true;
  } else if (s.status === 'loading') {
    status = track.size > 0 ? t('player.sizeLoading', { size: formatBytes(track.size) }) : t('player.loading');
  } else if (s.status === 'paused') status = t('player.paused');
  else if (s.status === 'ended') status = t('player.ended');

  return (
    <section ref={ref} className={cn('studio', isPlaying && 'playing')} aria-label={t('player.aria')}>
      <div className="top">
        <div className="disc">
          <i>
            <Icon name="headphone" className="size-5" />
          </i>
        </div>
        <div className="info">
          <strong title={track.title}>{track.title}</strong>
          <small className={cn(statusIsError && 'err')}>{status}</small>
        </div>
        <a className="btn" href={track.downloadUrl} title={t('player.downloadTitle')}>
          <LegacyIcon name="document-download" strokeWidth={1.8} />
          {t('download')}
        </a>
        <button
          type="button"
          className="ic"
          aria-label={t('player.close')}
          title={t('player.closeTitle')}
          onClick={() => audioPlayer.close()}
        >
          <Icon name="close" className="size-4" />
        </button>
      </div>

      <Waveform seed={`${track.key}_${track.size}`} duration={s.duration} currentTime={s.currentTime} playing={isPlaying} />

      <div className="ctl">
        <div className="vol">
          <button
            type="button"
            className="ic"
            aria-label={t('player.mute')}
            title={t('player.mute')}
            onClick={() => audioPlayer.toggleMute()}
          >
            {s.volume === 0 ? (
              <LegacyIcon name="speaker-off" strokeWidth={1.8} className="text-[#ef4444]" />
            ) : (
              <LegacyIcon name="speaker-on" strokeWidth={1.8} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={s.volume}
            aria-label={t('player.volume')}
            title={t('player.volume')}
            onChange={(e) => audioPlayer.setVolume(Number(e.target.value))}
          />
          <span>{s.volume}%</span>
        </div>

        <div className="mid">
          <button type="button" className="ic" aria-label={t('player.restart')} title={t('player.restart')} onClick={() => audioPlayer.restart()}>
            <LegacyIcon name="skip-back" strokeWidth={2} className="size-[15px]" />
          </button>
          <button type="button" className="ic skip" aria-label={t('player.back10')} title={t('player.back10')} onClick={() => audioPlayer.skipBy(-10)}>
            −10s
          </button>
          <button
            type="button"
            className="play"
            aria-label={t('player.playPause')}
            title={t('player.playPause')}
            onClick={() => audioPlayer.toggle()}
          >
            <PlayGlyph paused={!isPlaying} />
          </button>
          <button type="button" className="ic skip" aria-label={t('player.fwd10')} title={t('player.fwd10')} onClick={() => audioPlayer.skipBy(10)}>
            +10s
          </button>
          <button
            type="button"
            className="ic"
            aria-label={t('player.loop')}
            title={t('player.loop')}
            aria-pressed={s.loop}
            onClick={() => audioPlayer.setLoop(!s.loop)}
          >
            <LegacyIcon name="repeat" strokeWidth={2} className="size-[15px]" />
          </button>
        </div>

        <div className="spd" role="group" aria-label={t('player.speed')}>
          {SPEEDS.map((rate) => (
            <button key={rate} type="button" aria-pressed={s.rate === rate} onClick={() => audioPlayer.setRate(rate)}>
              {rate === 1 ? '1.0' : rate === 2 ? '2.0' : rate}x
            </button>
          ))}
        </div>
      </div>
    </section>
  );
});

function Waveform({ seed, duration, currentTime, playing }: { seed: string; duration: number; currentTime: number; playing: boolean }) {
  const { t } = useTranslation('recording');
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hover = useRef<number | null>(null);
  const drag = useRef(false);
  const wave = useMemo(() => makeWaveform(seed), [seed]);
  const total = Math.max(1, duration);
  const [, force] = useState(0);

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(CANVAS_HEIGHT * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(CANVAS_HEIGHT * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(wrap);
    const color = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
    const op = color('--op', '#3ea6ff');
    const cl = color('--cl', '#c58bff');
    const dim = color('--dim', '#2a3858');
    const head = color('--head', '#fff');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CANVAS_HEIGHT);
    const mid = CANVAS_HEIGHT / 2;
    const bw = width / WAVEFORM_BARS;
    const px = Math.min(Math.max((audioPlayer.position / total) * width, 0), width);
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const x = i * bw;
      const a = wave.amp[i] * (CANVAS_HEIGHT / 2 - 6);
      const played = x + bw / 2 <= px;
      const who = wave.who[i];
      ctx.fillStyle = who === 0 ? (played ? op : dim) : who === 1 ? (played ? cl : dim) : dim;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x + 1, mid - a, Math.max(bw - 2, 1), a * 2 || 1, 1.5);
      else ctx.rect(x + 1, mid - a, Math.max(bw - 2, 1), a * 2 || 1);
      ctx.fill();
    }
    ctx.fillStyle = head;
    ctx.fillRect(px - 1, 0, 2, CANVAS_HEIGHT);
    ctx.beginPath();
    ctx.arc(px, mid, 5, 0, Math.PI * 2);
    ctx.fill();
    if (hover.current !== null) {
      ctx.fillStyle = 'rgba(128,140,170,0.7)';
      ctx.fillRect(hover.current, 0, 1, CANVAS_HEIGHT);
    }
  };

  // Smooth playhead while playing; a single redraw otherwise.
  useEffect(() => {
    draw();
    if (!playing) return;
    let raf = requestAnimationFrame(function loop() {
      draw();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  });

  useEffect(() => {
    const onResize = () => force((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const seekTo = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    audioPlayer.seek(((clientX - rect.left) / rect.width) * total);
    draw();
  };

  const showTip = (clientX: number) => {
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    if (!canvas || !tip) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    hover.current = x;
    tip.style.left = `${x + 16}px`;
    tip.style.opacity = '1';
    tip.textContent = formatDuration((x / rect.width) * total);
  };

  return (
    <div className="wave" ref={wrapRef}>
      <div className="who">
        <span style={{ '--c': 'var(--op)' } as React.CSSProperties}>{t('player.operator')}</span>
        <span style={{ '--c': 'var(--cl)' } as React.CSSProperties}>{t('player.client')}</span>
      </div>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="slider"
        aria-label={t('player.timeline')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={formatDuration(currentTime)}
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          showTip(e.clientX);
          if (drag.current) seekTo(e.clientX);
          else draw();
        }}
        onPointerUp={() => {
          drag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = false;
        }}
        onPointerLeave={() => {
          hover.current = null;
          if (tipRef.current) tipRef.current.style.opacity = '0';
          draw();
        }}
      />
      <div className="tip" ref={tipRef}>
        00:00
      </div>
      <div className="time">
        <span>
          <b>{formatDuration(currentTime)}</b>
        </span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}

/** Floating "+5s (01:23)" toast after a keyboard skip (legacy, auto-hides after 700 ms). */
export function SkipToast() {
  const { skip } = useAudioPlayer();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!skip) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 700);
    return () => clearTimeout(timer);
  }, [skip]);
  if (!skip) return null;
  const fwd = skip.delta > 0;
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed bottom-[34px] left-1/2 z-[999999] flex items-center gap-2 rounded-3xl border border-[rgba(56,189,248,0.45)] bg-[rgba(15,23,42,0.94)] px-5 py-2 text-[13px] font-bold text-[#f8fafc] backdrop-blur-[10px] transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'shadow-[0_12px_30px_-5px_rgba(0,0,0,0.6),0_0_18px_rgba(56,189,248,0.25)]',
        visible ? '-translate-x-1/2 translate-y-0 opacity-100' : '-translate-x-1/2 translate-y-[15px] opacity-0',
      )}
    >
      <LegacyIcon name={fwd ? 'rotate-cw' : 'rotate-ccw'} strokeWidth={2.2} className={cn('size-4', fwd ? 'text-[#38bdf8]' : 'text-[#a855f7]')} />
      <span className={fwd ? 'text-[#38bdf8]' : 'text-[#c084fc]'}>
        {fwd ? '+' : '-'}
        {Math.abs(skip.delta)}s
      </span>
      <span className="text-[11px] font-medium text-[#94a3b8]">({formatDuration(skip.position)})</span>
    </div>
  );
}
