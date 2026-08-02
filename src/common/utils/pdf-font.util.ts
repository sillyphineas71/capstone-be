import * as fs from 'fs';
import * as path from 'path';
import type PDFKit from 'pdfkit';

/**
 * Font Unicode dùng chung cho mọi PDF renderer (thay Helvetica mặc định của
 * pdfkit — chỉ hỗ trợ WinAnsi, không hiển thị được tiếng Việt có dấu).
 * Mirror cách resolve path đã dùng ở ivss-presence-report.service.ts:
 * __dirname-relative trước (chạy đúng cả src dev/jest lẫn dist prod),
 * rồi process.cwd() fallback. nest-cli.json copy *.ttf → dist/assets/fonts.
 */
export const VN_FONT_REGULAR = 'VN-Regular';
export const VN_FONT_BOLD = 'VN-Bold';

const REGULAR_CANDIDATES = [
  path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  path.join(process.cwd(), 'src', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  path.join(process.cwd(), 'dist', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
];

const BOLD_CANDIDATES = [
  path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Bold.ttf'),
  path.join(process.cwd(), 'src', 'assets', 'fonts', 'NotoSans-Bold.ttf'),
  path.join(process.cwd(), 'dist', 'assets', 'fonts', 'NotoSans-Bold.ttf'),
];

function resolveFontPath(candidates: string[]): string {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

const regularPath = resolveFontPath(REGULAR_CANDIDATES);
const boldPath = resolveFontPath(BOLD_CANDIDATES);

/**
 * Đăng ký font Unicode (Noto Sans) vào document dưới tên `VN_FONT_REGULAR` /
 * `VN_FONT_BOLD`. Gọi ngay sau khi tạo `PDFDocument`, trước mọi lệnh
 * `doc.font(...)`/`doc.text(...)`.
 */
export function registerVietnamesePdfFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(VN_FONT_REGULAR, regularPath);
  doc.registerFont(VN_FONT_BOLD, boldPath);
}
