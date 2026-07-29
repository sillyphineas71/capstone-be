import { detectImageMimeType } from './image-magic-bytes.util.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho detectImageMimeType (VL-02 / FR-015).
 * Trace: AC-008.
 */
describe('detectImageMimeType (magic bytes)', () => {
  it('JPEG signature (FF D8 FF) → image/jpeg', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageMimeType(buf)).toBe('image/jpeg');
  });

  it('PNG signature → image/png', () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(detectImageMimeType(buf)).toBe('image/png');
  });

  it('WEBP signature (RIFF....WEBP) → image/webp', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(detectImageMimeType(buf)).toBe('image/webp');
  });

  it('PDF buffer (%PDF) → null (AC-008: pdf đổi tên .jpg)', () => {
    const buf = Buffer.from('%PDF-1.7\n', 'ascii');
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it('buffer random → null', () => {
    const buf = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it('buffer rỗng → null', () => {
    expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('buffer quá ngắn (1 byte) → null', () => {
    expect(detectImageMimeType(Buffer.from([0xff]))).toBeNull();
  });

  it('undefined/null → null', () => {
    expect(detectImageMimeType(undefined)).toBeNull();
    expect(detectImageMimeType(null)).toBeNull();
  });

  it('RIFF nhưng không phải WEBP (ví dụ WAV) → null', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(detectImageMimeType(buf)).toBeNull();
  });
});
