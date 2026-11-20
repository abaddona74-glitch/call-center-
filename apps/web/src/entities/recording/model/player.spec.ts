import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerTrack } from './player';

/** Just enough of HTMLAudioElement for the store (tests run in Node, no DOM). */
class FakeAudio {
  static last: FakeAudio | null = null;
  src = '';
  currentTime = 0;
  playbackRate = 1;
  loop = false;
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  preload = '';
  duration = Number.NaN;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  addEventListener = vi.fn();
  removeAttribute = vi.fn();
  constructor() {
    FakeAudio.last = this;
  }
}

const track = (key: string): PlayerTrack => ({
  key,
  title: key,
  src: `/rec/${key}`,
  downloadUrl: `/rec/${key}?dl=1`,
  size: 0,
});

describe('audio player: play vs load', () => {
  let audioPlayer: typeof import('./player').audioPlayer;

  beforeAll(async () => {
    vi.stubGlobal('Audio', FakeAudio);
    ({ audioPlayer } = await import('./player'));
  });
  afterAll(() => vi.unstubAllGlobals());

  it('load shows the track paused at 0:00 and never starts it (call details dialog)', () => {
    audioPlayer.load(track('call:1'));
    expect(audioPlayer.getState()).toMatchObject({
      track: { key: 'call:1' },
      status: 'paused',
      started: false,
      currentTime: 0,
    });
    expect(FakeAudio.last?.src).toBe('/rec/call:1');
    expect(FakeAudio.last?.play).not.toHaveBeenCalled();
  });

  it('play after load starts the loaded track', () => {
    audioPlayer.toggle();
    expect(FakeAudio.last?.play).toHaveBeenCalledTimes(1);
    expect(audioPlayer.getState().started).toBe(true);
  });

  it('play starts at once (row «Tinglash», Audio Explorer)', () => {
    audioPlayer.play(track('call:2'));
    expect(audioPlayer.getState()).toMatchObject({ track: { key: 'call:2' }, status: 'loading', started: true });
    expect(FakeAudio.last?.play).toHaveBeenCalledTimes(2);
  });

  it('loading another track paused resets "started" (the row offers «Tinglash», not «Davom ettirish»)', () => {
    audioPlayer.load(track('call:3'));
    expect(audioPlayer.getState()).toMatchObject({ track: { key: 'call:3' }, status: 'paused', started: false });
  });

  it('close unloads the track, so nothing is left for the global shortcuts', () => {
    audioPlayer.close();
    expect(audioPlayer.getState()).toMatchObject({ track: null, status: 'idle' });
  });
});
