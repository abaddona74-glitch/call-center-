/**
 * Minimal RIFF/WAVE reader and slicer for PBX recordings (Asterisk `wav`: PCM 16-bit mono 8 kHz). Lets the worker cut
 * speaker turns without ffmpeg. Other encodings (GSM `WAV`, μ-law) are reported as not sliceable: the worker then sends
 * the whole file to STT (the server decodes any format).
 */
export interface WavInfo {
  /** 1 = PCM. */
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
  durationSec: number;
  sliceable: boolean;
}

export class WavError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavError';
  }
}

export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new WavError('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataLength' | 'durationSec' | 'sliceable'> | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) throw new WavError('truncated fmt chunk');
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new WavError('data before fmt');
      // Asterisk leaves the size at 0 / 0xFFFFFFFF while recording; take what is there.
      if (size === 0 || body + size > buf.length) size = buf.length - body;
      const bytesPerSec = fmt.sampleRate * fmt.blockAlign;
      return {
        ...fmt,
        dataOffset: body,
        dataLength: size,
        durationSec: bytesPerSec > 0 ? size / bytesPerSec : 0,
        sliceable: fmt.format === 1 && fmt.blockAlign > 0 && fmt.sampleRate > 0,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new WavError('no data chunk');
}

function header(info: WavInfo, dataLength: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(info.format, 20);
  h.writeUInt16LE(info.channels, 22);
  h.writeUInt32LE(info.sampleRate, 24);
  h.writeUInt32LE(info.sampleRate * info.blockAlign, 28);
  h.writeUInt16LE(info.blockAlign, 32);
  h.writeUInt16LE(info.bitsPerSample, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLength, 40);
  return h;
}

/** A new WAV with the audio between `startSec` and `endSec` (clamped to the recording, whole sample frames). */
export function sliceWav(buf: Buffer, info: WavInfo, startSec: number, endSec: number): Buffer {
  if (!info.sliceable) throw new WavError('this WAV encoding cannot be sliced');
  const frame = info.blockAlign;
  const bytesPerSec = info.sampleRate * frame;
  const clamp = (sec: number) =>
    Math.min(info.dataLength, Math.max(0, Math.floor((sec * bytesPerSec) / frame) * frame));
  const a = clamp(startSec);
  const b = Math.max(a, clamp(endSec));
  const data = buf.subarray(info.dataOffset + a, info.dataOffset + b);
  return Buffer.concat([header(info, data.length), data]);
}
