/**
 * Shared branded HTML layout + building blocks for all outbound emails.
 * Inline CSS + table-based layout for maximum email-client compatibility.
 */

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** VD: "14:00, Thứ Ba 05/08/2026" thay vì raw ISO string. */
export function formatDateTimeVN(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatted = new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export interface InfoRow {
  label: string;
  /** Đã là HTML an toàn (đã escape nếu cần) — không escape lại ở đây. */
  value: string;
}

export function renderParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151;">${html}</p>`;
}

export function renderInfoTable(rows: InfoRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:9px 14px;font-size:13px;color:#6b7280;width:150px;border-bottom:1px solid #f0f1f3;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td>
        <td style="padding:9px 14px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #f0f1f3;">${r.value}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#f9fafb;border-radius:6px;margin:4px 0 18px;overflow:hidden;">${body}</table>`;
}

export function renderList(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#374151;line-height:1.8;">${items
    .map((i) => `<li>${i}</li>`)
    .join('')}</ul>`;
}

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success';

const TONE_COLORS: Record<
  CalloutTone,
  { bg: string; border: string; text: string }
> = {
  info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
  warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
  danger: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
  success: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
};

export function renderCallout(
  html: string,
  tone: CalloutTone = 'info',
): string {
  const c = TONE_COLORS[tone];
  return `<div style="background-color:${c.bg};border-left:4px solid ${c.border};padding:12px 16px;border-radius:4px;margin:0 0 18px;font-size:13px;color:${c.text};line-height:1.6;">${html}</div>`;
}

export interface EmailLayoutOptions {
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background-color:#1e3a8a;padding:22px 32px;">
                <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px;">Smart Meeting Management</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:19px;color:#111827;">${escapeHtml(opts.heading)}</h1>
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                  Đây là email tự động từ hệ thống Smart Meeting Management — vui lòng không trả lời email này.${opts.footerNote ? `<br/>${opts.footerNote}` : ''}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
