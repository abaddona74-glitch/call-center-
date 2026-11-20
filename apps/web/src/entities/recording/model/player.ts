import { EMPTY_RECORDING_MAX_BYTES, WAV_BYTES_PER_SECOND } from '@cc/shared';
import { useSyncExternalStore } from 'react';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PlayerError = 'open_failed' | 'play_failed';

export interface PlayerTrack {
  /** File path or `call:<uniqueid>` — lets row buttons know what is playing. */
  key: string;
  title: string;
  src: string;
  downloadUrl: string;
  size: number;
}

export interface PlayerState {
  track: PlayerTrack | null;
  status: PlayerStatus;
  error: PlayerError | null;
  currentTime: number;
  /** Real duration once metadata is loaded, the (size-44)/16000 estimate before. */
  duration: number;
  volume: number;
  muted: boolean;
  loop: boolean;
  rate: number;
  /** Last keyboard skip (drives the skip toast). */
  skip: { delta: number; position: number; at: number } | null;
}

const INITIAL: PlayerState = {
  track: null,
  status: 'idle',
  error: null,
  currentTime: 0,
  duration: 0,
  volume: 100,
  muted: false,
  loop: false,
  rate: 1,
  skip: null,
};

function estimateSeconds(size: number): number {
  return size > EMPTY_RECORDING_MAX_BYTES ? (size - EMPTY_RECORDING_MAX_BYTES) / WAV_BYTES_PER_SECOND : 0;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * One shared <audio> for the whole app (legacy: one global element used by every page).
 * The explorer "Studio" card, row play buttons and keyboard shortcuts all drive this store.
 */
class AudioPlayerStore {
  private audio: HTMLAudioElement | null = null;
  private state: PlayerState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private previousVolume = 100;
  private keysInstalled = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlayerState => this.state;

  /** Live position (smoother than `state.currentTime`, which follows `timeupdate`). */
  get position(): number {
    return this.audio?.currentTime ?? 0;
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private element(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0) this.set({ duration: a.duration });
    });
    a.addEventListener('timeupdate', () => this.set({ currentTime: a.currentTime }));
    a.addEventListener('playing', () => this.set({ status: 'playing', error: null }));
    a.addEventListener('pause', () => {
      if (this.state.track && !a.ended && this.state.status !== 'error') this.set({ status: 'paused' });
    });
    a.addEventListener('ended', () => this.set({ status: 'ended', currentTime: a.duration || this.state.currentTime }));
    a.addEventListener('error', () => {
      if (this.state.track) this.set({ status: 'error', error: 'open_failed' });
    });
    this.audio = a;
    return a;
  }

  /** Loads the track and starts it (row «Tinglash», Audio Explorer). */
  play(track: PlayerTrack): void {
    this.open(track, true);
  }

  /** Loads the track paused at 0:00: the player shows it, nothing sounds until play (call details dialog). */
  load(track: PlayerTrack): void {
    this.open(track, false);
  }

  private open(track: PlayerTrack, autoplay: boolean): void {
    const a = this.element();
    a.pause();
    a.src = track.src;
    a.currentTime = 0;
    a.playbackRate = this.state.rate;
    a.loop = this.state.loop;
    const volume = this.state.volume === 0 ? 100 : this.state.volume;
    a.volume = volume / 100;
    a.muted = false;
    this.set({
      track,
      status: autoplay ? 'loading' : 'paused',
      error: null,
      currentTime: 0,
      duration: estimateSeconds(track.size),
      volume,
      muted: false,
    });
    if (autoplay) this.start();
    this.installKeys();
  }

  private start(): void {
    this.audio?.play().catch((err: unknown) => {
      if ((err as Error).name === 'AbortError') return;
      this.set({ status: 'error', error: 'play_failed' });
    });
  }

  toggle(): void {
    const a = this.audio;
    if (!a || !this.state.track) return;
    if (a.paused) {
      if (a.ended) a.currentTime = 0;
      this.start();
    } else {
      a.pause();
    }
  }

  pause(): void {
    this.audio?.pause();
  }

  seek(seconds: number): void {
    const a = this.audio;
    if (!a || !this.state.track) return;
    const max = this.state.duration || a.duration || 0;
    a.currentTime = Math.min(Math.max(0, seconds), max || Number.POSITIVE_INFINITY);
    this.set({ currentTime: a.currentTime, status: this.state.status === 'ended' ? 'paused' : this.state.status });
  }

  skipBy(delta: number, withToast = false): void {
    if (!this.audio || !this.state.track) return;
    this.seek(this.audio.currentTime + delta);
    if (withToast) this.set({ skip: { delta, position: this.audio.currentTime, at: Date.now() } });
  }

  restart(): void {
    this.seek(0);
    this.start();
  }

  setVolume(volume: number): void {
    const v = Math.round(Math.min(100, Math.max(0, volume)));
    if (v > 0) this.previousVolume = v;
    if (this.audio) this.audio.volume = v / 100;
    this.set({ volume: v, muted: v === 0 });
  }

  toggleMute(): void {
    if (this.state.muted || this.state.volume === 0) this.setVolume(this.previousVolume || 100);
    else {
      this.previousVolume = this.state.volume;
      this.setVolume(0);
    }
  }

  setLoop(loop: boolean): void {
    if (this.audio) this.audio.loop = loop;
    this.set({ loop });
  }

  setRate(rate: number): void {
    if (this.audio) this.audio.playbackRate = rate;
    this.set({ rate });
  }

  close(): void {
    const a = this.audio;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.set({ track: null, status: 'idle', error: null, currentTime: 0, duration: 0, skip: null });
  }

  /**
   * Legacy global shortcuts while audio is loaded (focus not in a text field):
   * ←/→ ±5 s (Shift ±10 s, with the skip toast), Space play/pause, ↑/↓ volume ±5 %.
   * One handler only — legacy also handled keys on the waveform and skipped twice.
   */
  private installKeys(): void {
    if (this.keysInstalled || typeof window === 'undefined') return;
    this.keysInstalled = true;
    window.addEventListener('keydown', (e) => {
      if (!this.state.track || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLButtonElement && e.key === ' ') return; // a focused button handles Space itself
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 5;
          this.skipBy(e.key === 'ArrowLeft' ? -step : step, true);
          break;
        }
        case ' ':
          e.preventDefault();
          this.toggle();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          this.setVolume(this.state.volume + (e.key === 'ArrowUp' ? 5 : -5));
          break;
        default:
      }
    });
  }
}

export const audioPlayer = new AudioPlayerStore();

export function useAudioPlayer(): PlayerState {
  return useSyncExternalStore(audioPlayer.subscribe, audioPlayer.getState);
}
