import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { IvssPresenceQueryService } from './ivss-presence-query.service.js';

interface HeaderRow {
  title: string | null;
  meeting_code: string | null;
  start_time: Date | string;
  end_time: Date | string;
  status: string;
  room_name: string | null;
}

interface SummaryRow {
  userId: string;
  fullName: string | null;
  durationMs: number;
  method: string;
  presentRatio: number;
  segmentCount: number;
  unmatchedCount: number;
}
interface MeetingPresence {
  participants: SummaryRow[];
  meetingUnmatchedIdentityCount: number;
}

// B1: thử __dirname-relative trước (work cả src dev/jest lẫn dist prod — cấu trúc song song),
// rồi process.cwd() fallback. nest-cli.json copy .ttf → dist/assets/fonts.
const FONT_CANDIDATES = [
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'assets',
    'fonts',
    'NotoSans-Regular.ttf',
  ),
  path.join(process.cwd(), 'src', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  path.join(process.cwd(), 'dist', 'assets', 'fonts', 'NotoSans-Regular.ttf'),
];

/**
 * IvssPresenceReportService (IPR-001 #43) — format getMeetingPresence (IPD-001) thành PDF tải về.
 *
 * READ-ONLY: tái dùng IvssPresenceQueryService.getMeetingPresence (KHÔNG query lại presence) + 1 query header.
 * C1 font Unicode VN embedded (doc.font trước render). B2 stream error-safe. B3 filename sanitize.
 * SEC-01 KHÔNG ảnh/base64 trong PDF. SEC-03 bind header query. ARCH-01 KHÔNG mutate.
 */
@Injectable()
export class IvssPresenceReportService {
  private readonly logger = new Logger(IvssPresenceReportService.name);
  private readonly fontPath = this.resolveFontPath();

  constructor(
    private readonly presenceQueryService: IvssPresenceQueryService,
    private readonly dataSource: DataSource,
  ) {}

  async buildMeetingReport(
    meetingId: string,
    callerId: string,
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    // [FIX 2026-08-13] EMPLOYEE bị chặn hẳn ở route PDF (khác JSON endpoint chỉ lọc còn
    // 1 dòng của chính họ) — báo cáo này là tài liệu quản lý/admin, không dành cho tự xem.
    // [FIX 2026-08-25] resolveScope() cần thêm meetingId (host-of-meeting check) — CỐ Ý vẫn
    // check `selfUserId !== null` ở đây (KHÔNG check isHostOfMeeting) nên host-employee VẪN bị
    // chặn PDF như trước, KHÔNG đổi hành vi — mở khoá PDF cho host là quyết định sản phẩm
    // riêng, ngoài phạm vi fix này.
    const scope = await this.presenceQueryService.resolveScope(
      callerId,
      meetingId,
    );
    if (scope.selfUserId !== null) {
      throw new ForbiddenException({
        success: false,
        message: 'You do not have permission to view this report',
        error: { code: 'PERMISSION_DENIED', details: {} },
      });
    }

    // MANAGER: getMeetingPresence() tự lọc còn participant trong scope (giống JSON
    // endpoint) — PDF vì vậy tự nhiên chỉ liệt kê đúng phần thuộc phòng ban mình quản lý,
    // rỗng nếu meeting không có ai thuộc phòng ban đó (đã có sẵn empty-state OQ-6 bên dưới).
    const presence = await this.presenceQueryService.getMeetingPresence(
      meetingId,
      callerId,
    );
    if (!presence) return null; // meeting không tồn tại → controller 404

    // [FIX 2026-08-25] Header PDF trước đây in giờ ĐẶT LỊCH (m.start_time/end_time trần) dù
    // presence.participants[] bên dưới (qua getMeetingPresence → loadBound()) đã tính đúng
    // theo giờ THẬT — 2 số liệu lệch nhau khi họp bắt đầu/kết thúc trễ/sớm hơn lịch. Đổi
    // sang COALESCE(actual_*, m.*) mirror ĐÚNG công thức đã dùng ở loadBound(), CHỈ đổi
    // nguồn dữ liệu cho dòng nhãn text — KHÔNG đụng participants[]/buildSession()/ratio().
    const headerRows: HeaderRow[] = await this.dataSource.manager.query(
      `SELECT m.title, m.meeting_code,
              COALESCE(m.actual_start_time, m.start_time) AS start_time,
              COALESCE(m.actual_end_time, m.end_time) AS end_time,
              m.status, r.room_name
         FROM meetings m
         LEFT JOIN rooms r ON r.id = m.room_id
        WHERE m.id = $1
        LIMIT 1`,
      [meetingId],
    );
    const header = headerRows[0] ?? null;

    const buffer = await this.renderPdf(header, presence);
    const code = header?.meeting_code || meetingId;
    const filename = `ivss-presence-${this.sanitize(code)}-${this.ymd()}.pdf`;
    return { buffer, filename };
  }

  // ── PDF render (B2 stream error-safe) ─────────────────────────────────────
  private renderPdf(
    header: HeaderRow | null,
    presence: MeetingPresence,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (e) => reject(e instanceof Error ? e : new Error('pdf')));
      try {
        doc.font(this.fontPath); // C1: TRƯỚC mọi render tên người.
        this.drawHeader(doc, header, presence);
        this.drawTable(doc, presence);
        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('pdf render failed'));
      }
    });
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    header: HeaderRow | null,
    presence: MeetingPresence,
  ): void {
    doc
      .fontSize(16)
      .text('IVSS — Báo cáo hiện diện cuộc họp', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Tên họp: ${header?.title ?? '—'}`);
    doc.text(`Mã họp: ${header?.meeting_code ?? '—'}`);
    doc.text(`Phòng: ${header?.room_name ?? '—'}`);
    if (header) {
      doc.text(
        `Thời gian: ${this.fmtTime(header.start_time)} – ${this.fmtTime(header.end_time)} (${header.status})`,
      );
    }
    doc.text(`Tổng người tham dự: ${presence.participants.length}`);
    doc.text(
      `Sự kiện chưa khớp định danh (cả họp): ${presence.meetingUnmatchedIdentityCount}`,
    );
    doc.moveDown(0.3);
    // OQ-5: chú thích method.
    doc
      .fontSize(8)
      .fillColor('gray')
      .text(
        'Ghi chú: method=approx → thời lượng xấp xỉ. presentRatio = thời lượng / độ dài họp.',
      )
      .fillColor('black');
    doc.moveDown(0.5);
  }

  private drawTable(doc: PDFKit.PDFDocument, presence: MeetingPresence): void {
    const cols = [
      { label: 'Họ tên', x: 40, w: 150 },
      { label: 'Thời lượng', x: 195, w: 70 },
      { label: 'Method', x: 270, w: 55 },
      { label: 'Tỉ lệ', x: 330, w: 45 },
      { label: 'Đoạn', x: 380, w: 45 },
      { label: 'Chưa khớp', x: 430, w: 70 },
    ];
    const rowH = 18;
    let y = doc.y;

    const drawRow = (cells: string[], bold = false): void => {
      doc.fontSize(bold ? 9 : 8);
      cols.forEach((c, i) => {
        doc.text(cells[i] ?? '', c.x, y, { width: c.w, ellipsis: true });
      });
      y += rowH;
    };

    drawRow(
      cols.map((c) => c.label),
      true,
    );
    y += 2;

    const hasData = presence.participants.some((p) => p.durationMs > 0);
    if (presence.participants.length === 0 || !hasData) {
      // OQ-6: meeting rỗng / chưa có dữ liệu IVSS.
      doc
        .fontSize(9)
        .fillColor('gray')
        .text('Chưa có dữ liệu IVSS cho cuộc họp này.', 40, y)
        .fillColor('black');
      y += rowH;
    }

    for (const p of presence.participants) {
      if (y > 800) {
        doc.addPage();
        y = doc.y;
        drawRow(
          cols.map((c) => c.label),
          true,
        );
        y += 2;
      }
      drawRow([
        p.fullName ?? '—',
        this.durationHuman(p.durationMs),
        p.method,
        this.fmtRatio(p.presentRatio),
        String(p.segmentCount),
        String(p.unmatchedCount),
      ]);
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private durationHuman(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  private fmtRatio(r: number): string {
    return `${Math.round((Number.isFinite(r) ? r : 0) * 100)}%`;
  }

  private fmtTime(d: Date | string): string {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toISOString().replace('T', ' ').slice(0, 16);
  }

  /** B3: filename chỉ [A-Za-z0-9._-] (chống header injection ở Content-Disposition). */
  private sanitize(s: string): string {
    const cleaned = String(s).replace(/[^A-Za-z0-9._-]/g, '_');
    return cleaned.length > 0 ? cleaned : 'report';
  }

  private ymd(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  private resolveFontPath(): string {
    for (const p of FONT_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
    this.logger.warn('IVSS report font không tìm thấy — dùng path mặc định.');
    return FONT_CANDIDATES[0];
  }
}
