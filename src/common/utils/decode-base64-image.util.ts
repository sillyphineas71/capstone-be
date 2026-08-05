export interface DecodedImage {
  buffer: Buffer;
  mimeType: string;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

/**
 * Decode ảnh base64 (có hoặc không có prefix `data:image/...;base64,`) → Buffer.
 * Input rỗng/không decode được (base64 rác, buffer rỗng) → null (caller tự bỏ qua,
 * KHÔNG throw — dùng cho các luồng webhook always-ack).
 */
export function decodeBase64Image(
  input: string | null | undefined,
): DecodedImage | null {
  if (!input) return null;

  const match = DATA_URL_RE.exec(input);
  const mimeType = match?.[1] ?? 'image/jpeg';
  const raw = match?.[2] ?? input;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;

  return { buffer, mimeType };
}
