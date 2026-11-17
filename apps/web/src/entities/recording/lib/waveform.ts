/**
 * The legacy Studio waveform is synthetic (no audio decoding): 220 bars from a seeded
 * Park–Miller generator, alternating "operator" / "client" turns with short gaps.
 * Deterministic per file (seed = path + size), so a file always looks the same.
 */
export const WAVEFORM_BARS = 220;

export interface Waveform {
  amp: Float32Array;
  /** 0 = operator, 1 = client, 2 = gap */
  who: Uint8Array;
}

export function makeWaveform(seedText: string): Waveform {
  let seed = 7;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647 || 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const amp = new Float32Array(WAVEFORM_BARS);
  const who = new Uint8Array(WAVEFORM_BARS);
  let i = 0;
  let w = 0;
  while (i < WAVEFORM_BARS) {
    const len = Math.floor(8 + rnd() * 22);
    const gap = Math.floor(rnd() * 4);
    for (let k = 0; k < len && i < WAVEFORM_BARS; k++, i++) {
      who[i] = w;
      amp[i] = 0.25 + rnd() * 0.75 * (0.6 + 0.4 * Math.sin(k / 2.2));
    }
    for (let k = 0; k < gap && i < WAVEFORM_BARS; k++, i++) {
      who[i] = 2;
      amp[i] = 0.04;
    }
    w = 1 - w;
  }
  return { amp, who };
}
