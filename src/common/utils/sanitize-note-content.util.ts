/**
 * Sanitize note content: strip/escape the HTML nguy hiem,
 * giu lai plain text / Markdown an toan (NFR-005).
 *
 * Khong them dependency nang (sanitize-html). Dung regex don gian.
 * Bo: <script>, <iframe>, on* events, javascript:, data:, vbscript:.
 */
export function sanitizeNoteContent(input: string): string {
  if (!input) return '';

  let result = input;

  // Remove <script> tags (including content)
  result = result.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    '',
  );

  // Remove <iframe> tags (including content)
  result = result.replace(
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    '',
  );

  // Remove event handlers: on{event}=...
  result = result.replace(/\s+on\w+\s*=\s*["\'][^"\']*["\']/gi, '');
  result = result.replace(/\s+on\w+\s*=\s*\S+/gi, '');

  // Remove javascript: data: vbscript: from href/src by removing the entire attribute
  result = result.replace(
    /\s+(?:href|src|action)\s*=\s*["\']\s*(?:javascript|data|vbscript)\s*:[^"\']*["\']/gi,
    '',
  );

  // Remove <style> tags (including content)
  result = result.replace(
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
    '',
  );

  return result.trim();
}
