# IPR-001 — plan.md (#43 IVSS presence report PDF)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo plan IPR-001 sau spec DUYỆT. OQ-1=(b) pdfkit→PDF. IvssPresenceReportService format `getMeetingPresence` (IPD-001) thành PDF tải về; font Unicode VN embedded. Thêm dependency pdfkit (C3). Read-only. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ. **Format-only, READ-ONLY.**

## 0. Quyết định đã chốt (OQ + C)
OQ-1 **pdfkit → PDF** (thêm dependency) · OQ-2 1 format PDF v1 · OQ-3 1 trang summary (header họp + bảng người: fullName/durationHuman/method/presentRatio%/segmentCount/unmatchedCount; timeline defer) · OQ-4 đồng bộ trong request · OQ-5 cột method + chú thích "approx=xấp xỉ" · OQ-6 meeting rỗng vẫn xuất (ghi chú "Chưa có dữ liệu IVSS"), không tồn tại→404 · OQ-7 `ivss-presence-<meeting_code|meetingId>-<YYYYMMDD>.pdf` · permission **`ivss.presence.read`** (dùng lại).
- **C1** font Unicode VN embedded · **C2** `@Res()` file, no envelope, lỗi không lộ path · **C3** dep pdfkit duyệt rõ · **C4** read-only (grep-proof).

## 1. ⚠ C1 — Font Unicode tiếng Việt (sống còn) + asset path
pdfkit default = **Helvetica → KHÔNG render dấu tiếng Việt** ("Trần Đức Hải" → mất dấu/ô vuông). Bắt buộc nhúng font `.ttf` Unicode.
- **Font chọn**: `NotoSans-Regular.ttf` — **license SIL Open Font License 1.1** (tự do, phủ Vietnamese). (Thay thế: DejaVuSans.ttf, free Bitstream-Vera-derived.)
- **Vị trí**: **repo-root `assets/fonts/NotoSans-Regular.ttf`** (commit binary vào repo — C3 "không tải runtime").
- **Đọc font**: `path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf')` → **hoạt động cả jest (cwd=repo root) lẫn prod `node dist/main` (cwd=repo root)**. KHÔNG phụ thuộc `__dirname` (khác nhau src vs dist) và KHÔNG cần sửa `nest-cli.json` (hiện không có `assets` config → `.ttf` không copy vào dist).
  - ⚠ Ràng buộc vận hành: prod chạy từ **repo root** (đúng convention `npm run start`). Nếu sau này chạy từ cwd khác → font không thấy → fallback: thêm `compilerOptions.assets` vào `nest-cli.json` + `__dirname`. Ghi residual.
- `doc.font(fontPath)` **TRƯỚC mọi render** có tên người. KHÔNG dùng Helvetica cho nội dung tên.

## 2. Dependency (C3)
- **Thêm**: `pdfkit` (dependencies) — **MIT**, latest stable (~`0.15.x`; pin exact version ở T0 sau `npm install`). Transitive: `fontkit`, `linebreak`, `png-js`… (MIT/tự do — verify ở T0; **dep lạ/nặng bất thường → DỪNG báo**).
- `@types/pdfkit` (devDependencies).
- `npm install` + `npm run build` phải pass (T0). KHÔNG puppeteer (tránh chromium).

## 3. IvssPresenceReportService (READ-ONLY)
- Inject: `IvssPresenceQueryService` (tái dùng `getMeetingPresence`, **KHÔNG query lại presence**), `DataSource` (chỉ 1 query header — SEC-03 bind).
- `buildMeetingReport(meetingId): Promise<{ buffer: Buffer; filename: string } | null>`:
  1. `getMeetingPresence(meetingId)` → **null → return null** (controller 404 — meeting không tồn tại).
  2. Header query (SEC-03 bind): `SELECT m.title, m.meeting_code, m.start_time, m.end_time, m.status, r.room_name FROM meetings m LEFT JOIN rooms r ON r.id = m.room_id WHERE m.id = $1`.
  3. `renderPdf(header, summary)` → Buffer (pdfkit).
  4. `filename = ivss-presence-${meeting_code ?? meetingId}-${YYYYMMDD}.pdf` (OQ-7).
- `renderPdf`:
  ```
  const doc = new PDFDocument({ size:'A4', margin:40 })
  doc.font(FONT_PATH)                                  // C1 trước render
  const chunks=[]; doc.on('data', c=>chunks.push(c))
  const done = new Promise<Buffer>(res => doc.on('end', ()=>res(Buffer.concat(chunks))))
  // Header họp: title, meeting_code, room (— nếu null), start–end, status, tổng participant, meetingUnmatchedIdentityCount
  // Chú thích (OQ-5): "method=approx → thời lượng xấp xỉ" + "presentRatio = thời lượng / độ dài họp"
  // OQ-6: nếu summary rỗng / mọi durationMs=0 → in dòng "Chưa có dữ liệu IVSS"
  // Bảng người (vẽ tay từng dòng — pdfkit không có grid): cột fullName | durationHuman | method | presentRatio% | segmentCount | unmatchedCount
  doc.end(); return done
  ```
- Helpers: `durationHuman(ms)` ("1h 05m" / "12m 30s" / "0m"); `fmtRatio(r)` (`${Math.round(r*100)}%`); `fmtTime(d)`.
- SEC-01: **KHÔNG** đưa imageBase64/ảnh vào PDF (data nguồn đã metadata-only).

## 4. Endpoint (C2) — admin-gated, @Res()
- Route mới trong **`ivss-presence.controller.ts`**: `GET :meetingId/presence/report` (full `/api/v1/ivss/meetings/:meetingId/presence/report`).
- `@UseGuards(JwtAuthGuard, MockPermissionsGuard)`, `@Permissions('ivss.presence.read')`, `@Param('meetingId', ParseUUIDPipe)`, **`@Res() res: Response`**.
- Luồng: `const r = await reportService.buildMeetingReport(meetingId)`; `if (!r) → res.status(404).json({ code:'MEETING_NOT_FOUND', message:'Meeting not found.' })` (hoặc throw NotFoundException trước khi chạm res); set `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="${r.filename}"`, `res.send(r.buffer)`. **Lỗi render → `res.status(500).end()` KHÔNG lộ path** (mirror media-files). **KHÔNG envelope** `{success,message,data}` (file download).

## 5. File list
### Net-new
- `assets/fonts/NotoSans-Regular.ttf` (binary, OFL-1.1, commit).
- `src/modules/ivss/services/ivss-presence-report.service.ts` (+ `.spec.ts`).
### Modified
- `src/modules/ivss/controllers/ivss-presence.controller.ts` (+ report route; + spec update).
- `src/modules/ivss/ivss.module.ts` (provider `IvssPresenceReportService`).
- `package.json` (+ pdfkit, + @types/pdfkit) + `package-lock.json`.
> KHÔNG migration, KHÔNG env, KHÔNG đụng occupancy/no-show/IPD-001 query logic.

## 6. Test (mock getMeetingPresence + mock header — KHÔNG thiết bị)
- Mock `IvssPresenceQueryService.getMeetingPresence` (summary giả) + mock `dataSource.manager.query` (header row) → `buildMeetingReport` → assert:
  - `buffer.length > 0` + bắt đầu `%PDF` (magic) → PDF hợp lệ.
  - `filename` đúng convention (OQ-7).
  - **C1**: feed `fullName='Trần Đức Hải'` → KHÔNG throw, buffer sinh ra (font Unicode load OK).
  - **SEC-01**: nguồn data không có ảnh → assert service KHÔNG nhận/đưa imageBase64 (shape không có).
- **OQ-6**: summary rỗng / mọi duration 0 → vẫn ra buffer (`%PDF`), không throw.
- meeting không tồn tại (`getMeetingPresence` null) → `buildMeetingReport` trả `null`.
- controller: null → 404; buffer → Content-Type/Disposition đúng; guard JwtAuthGuard wiring; lỗi service throw → res 500 (không lộ path).
- Coverage **≥80%** `ivss-presence-report.service.ts`.

## 7. Gate (STOP, KHÔNG commit)
- **T0 dep**: `npm install pdfkit @types/pdfkit` → ghi version vào plan/báo cáo; verify transitive deps (MIT/tự do; lạ/nặng → DỪNG); `npm run build`=0.
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`/`ivss-presence.controller.ts`/`package.json`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% report service; **C4 grep read-only**: `INSERT|UPDATE|DELETE` rỗng trong `ivss-presence-report.service.ts`; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies); font file tồn tại + load được. **KHÔNG live.**
- **Owed**: số liệu phụ thuộc thiết bị (kế thừa IPD-001) + `method=approx` cảnh báo; seed permission `ivss.presence.read`; cwd-assumption font (residual §1).

## 8. Kỷ luật
- **No-migration** (read-only). **SEC-02** admin-gated `ivss.presence.read`. **SEC-01** file KHÔNG ảnh/base64 — chỉ metadata. **SEC-03** bind tham số header query + ParseUUIDPipe. **ARCH-01** tái dùng `IvssPresenceQueryService` (KHÔNG query lại presence), chỉ +1 query header; READ-ONLY KHÔNG đụng occupancy/no-show. **C4** KHÔNG mutate (grep-proof). **C3** dep duyệt + commit font + build pass.
- `@Res()` file download → KHÔNG envelope; lỗi không lộ path nội bộ.

> **STOP.** Plan + tasks chờ review trước khi code.
