/**
 * ACCT-BIOMETRIC-SUBMIT-001 (VL-02 / FR-015): Phát hiện MIME type thực tế của file ảnh
 * bằng magic bytes (file signature), KHÔNG tin vào file.mimetype của Multer hay
 * extension do client khai báo.
 *
 * Chỉ hỗ trợ đúng 3 định dạng spec cho phép: image/jpeg, image/png, image/webp.
 * Tự viết để tránh thêm npm dependency (file-type v17+ là ESM-only, không hợp
 * cấu hình module: nodenext không "type":"module" của project).
 */
export type AllowedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMimeType(
  buffer: Buffer | undefined | null,
): AllowedImageMime | null {
  if (!buffer || buffer.length === 0) {
    return null;
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: "RIFF" .... "WEBP" (byte 0-3 = RIFF, byte 8-11 = WEBP)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
