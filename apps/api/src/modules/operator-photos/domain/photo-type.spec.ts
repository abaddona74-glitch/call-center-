import { describe, expect, it } from 'vitest';
import { detectPhotoType } from './photo-type.js';

const bytes = (...b: number[]) => Buffer.from(b);

describe('detectPhotoType', () => {
  it('accepts JPEG, PNG and WEBP by their first bytes', () => {
    expect(detectPhotoType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(detectPhotoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(detectPhotoType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe('image/webp');
  });

  it('refuses SVG, GIF, HTML and anything named like an image but not one', () => {
    expect(detectPhotoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectPhotoType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectPhotoType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectPhotoType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectPhotoType(Buffer.alloc(0))).toBeNull();
  });
});
