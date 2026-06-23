# IPR-001 — IVSS per-person per-meeting report (#43): xuất Excel/PDF tải về

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo spec IPR-001 (#43): format `getMeetingPresence` (IPD-001) thành file tải về (.xlsx/PDF). RECON code thật. ⚠ CHƯA có lib sinh file → cần duyệt dependency. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. **Format-only** — tái dùng `IvssPresenceQueryService.getMeetingPresence` (IPD-001 #41/#42, đã commit), KHÔNG tính lại. KHÔNG WS (#40), KHÔNG cross-meeting analytics.

---

## ⚠ BLOCKER (cần Thiếu Chủ duyệt TRƯỚC khi plan/tasks)
**Codebase HIỆN KHÔNG có thư viện sinh file** (Excel/PDF/CSV) — xem RECON 0.1. #43 **bắt buộc thêm dependency** (vd `exceljs` cho `.xlsx`). Đây là **quyết định cần duyệt** (không tự thêm). → Xem **OQ-1**. Nếu KHÔNG duyệt thêm lib: fallback CSV thủ công (không cần lib, kém đẹp) — nêu trong OQ-1.

---

## 0. RECON findings (đọc CODE THẬT)

### 0.1. Lib sinh file — KHÔNG CÓ (crux)
- `package.json`: **không** `exceljs` / `xlsx` / `pdfkit` / `puppeteer` / `pdf-lib` / `jspdf` / `json2csv` / `officegen` / `docx` (grep rỗng).
- Code: **không** import lib sinh file nào (grep `src` rỗng).
- **Reports module** ([reports.module.ts](../../../../src/modules/reports/reports.module.ts)): **skeleton** — chưa có service/lib export; không sinh Excel/PDF/CSV.
- ⇒ Sinh `.xlsx`/PDF **đòi thêm dependency mới**. (CSV có thể thủ công bằng string, không cần lib.)

### 0.2. Download pattern (mirror)
[media-files.controller.ts:71-87](../../../../src/modules/recording/controllers/media-files.controller.ts): playback dùng **`@Res() res: Response`** (Express) + `res.setHeader('Content-Type', …)` + stream/write; `@Res()` ⇒ **tự quản response, KHÔNG envelope** `{success,message,data}` (đúng cho file). Lỗi → `res.status(500).end()` (KHÔNG lộ path nội bộ). → #43 mirror: set `Content-Type` + `Content-Disposition: attachment; filename="…"` + `res.send(buffer)` (file nhẹ, không cần stream chunk).

### 0.3. Meeting header data
`meetings.title` ([:59](../../../../src/modules/meetings/entities/meeting.entity.ts)), `meeting_code`, `start_time`/`end_time`/`status`, `room_id` (nullable). `rooms.room_name`/`room_code`. → header query gọn: `SELECT m.title, m.meeting_code, m.start_time, m.end_time, m.status, r.room_name, r.room_code FROM meetings m LEFT JOIN rooms r ON r.id = m.room_id WHERE m.id=$1` (1 query nhẹ cho header; participant rows từ `getMeetingPresence`).

### 0.4. Endpoint admin-gated (mirror IPD-001)
[ivss-presence.controller.ts](../../../../src/modules/ivss/controllers/ivss-presence.controller.ts): `@Controller('ivss/meetings')` + `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('…')` + `ParseUUIDPipe`. #43 thêm route `GET :meetingId/presence/report` cùng controller-style (file download → `@Res()`, KHÔNG envelope).

### 0.5. Format khả thi
Chỉ khả thi theo lib được duyệt (OQ-1): `.xlsx` cần `exceljs`/`xlsx`; PDF cần `pdfkit`/`puppeteer`; CSV không cần lib (string thủ công). **Hiện 0 lib** → mặc định chỉ CSV làm được ngay; `.xlsx`/PDF chờ duyệt.

---

## 1. Scope #43 (format-only, tái dùng IPD-001)
1. Gọi `getMeetingPresence(meetingId)` (KHÔNG query lại presence) + 1 query header (0.3).
2. Format thành file (theo OQ-1/2): per-meeting = header họp + 1 dòng/người (tên/duration/method/presentRatio/segmentCount/unmatched) + tổng quan.
3. Trả file qua HTTP download (`@Res()`, Content-Disposition).

KHÔNG: tính presence (#41/#42), WS (#40), cross-meeting/analytics.

## 2. Endpoint download (admin-gated)
- `GET /api/v1/ivss/meetings/:meetingId/presence/report?format=xlsx|pdf|csv` (format theo OQ-2; default theo lib được duyệt).
- Guard `JwtAuthGuard + MockPermissionsGuard`, `@Permissions('ivss.presence.read')` (tái dùng quyền IPD-001, hoặc `ivss.presence.report` riêng — chốt). `ParseUUIDPipe` cho meetingId.
- `@Res() res`: set `Content-Type` (vd `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` cho xlsx / `application/pdf` / `text/csv`), `Content-Disposition: attachment; filename="<OQ-7>"`, `res.send(buffer)`. Lỗi → 500 không lộ path. SEC-02 admin-only.

## 3. Nội dung report (OQ-3)
- **Header họp**: title, meeting_code, room_name (hoặc "—" nếu null), start/end time, status, tổng participant, `meetingUnmatchedIdentityCount`.
- **Bảng người** (1 dòng/participant): `fullName`, `durationHuman` (từ `durationMs`, vd "1h 05m"), `method` (interval/approx), `presentRatio` (%), `segmentCount`, `unmatchedCount`.
- **Chú thích (OQ-5)**: "method=approx → thời lượng xấp xỉ"; "presentRatio = thời lượng / độ dài họp".
- v1: **1 sheet summary** (OQ-3); timeline chi tiết per-person (sheet 2) defer.

## 4. Lib/format (OQ-1) — phụ thuộc duyệt
- Nếu duyệt **`exceljs`** → `.xlsx` (đề xuất: data-grid hợp bảng người×chỉ số).
- Nếu duyệt lib PDF → PDF.
- Nếu **KHÔNG duyệt lib** → **CSV thủ công** (string, escape; không cần dependency) — kém đẹp nhưng tải/mở Excel được.
- SEC-01: file **KHÔNG chứa imageBase64/ảnh** (data nguồn IPD-001 đã metadata-only).

## 5. Sinh đồng bộ (OQ-4)
Đề xuất **đồng bộ trong request** (data nhẹ: N participant, đã tính sẵn ở IPD-001) → build buffer → send. KHÔNG background job v1.

## 6. Test (mock getMeetingPresence — KHÔNG thiết bị)
- Mock `IvssPresenceQueryService.getMeetingPresence` trả summary giả + mock header query → gọi endpoint → assert: file sinh ra (buffer length > 0), `Content-Type` + `Content-Disposition` (filename theo OQ-7) đúng, **KHÔNG chứa base64/ảnh**.
- Nếu lib mới (exceljs/pdf) → smoke test buffer ≠ 0 (không parse sâu nội dung file). CSV → assert có header cột + 1 dòng/người + escape đúng.
- meeting rỗng (OQ-6) → vẫn xuất (participant duration 0 + ghi chú) hoặc 404 (theo chốt).
- meeting không tồn tại (getMeetingPresence null) → 404.
- Coverage ≥80% report service (format logic).

## 7. Constitution
- **SEC-02**: endpoint admin-gated (JwtAuthGuard + PermissionsGuard).
- **SEC-01**: file KHÔNG chứa ảnh/base64; chỉ metadata (tên, số liệu).
- **ARCH-01**: **tái dùng** `IvssPresenceQueryService` (KHÔNG query lại presence); chỉ +1 query header. READ-ONLY — KHÔNG mutate, KHÔNG đụng occupancy/no-show.
- **DATA-01**: no-migration (read-only).
- **DEP**: thêm lib (nếu OQ-1 duyệt) = dependency mới → ghi rõ version, license; KHÔNG tự thêm trước duyệt.

## 8. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux) lib/format**: codebase **0 lib sinh file** (RECON 0.1). Chọn:
  - **(a)** Duyệt thêm **`exceljs`** → `.xlsx` **[đề xuất nếu chấp nhận thêm dependency]** (phổ biến, MIT, data-grid đẹp).
  - **(b)** Duyệt lib PDF (`pdfkit`/`puppeteer`) → PDF (puppeteer nặng ~chromium; pdfkit nhẹ hơn nhưng layout thủ công).
  - **(c)** **KHÔNG thêm lib** → **CSV thủ công** (không dependency, mở được bằng Excel) — kém đẹp, không đa sheet.
  → **Cần Thiếu Chủ chốt (a)/(b)/(c).** Nếu (a)/(b) → DỪNG thêm lib cho tới khi duyệt; plan/tasks viết sau khi chốt.
- **OQ-2 format v1**: 1 format (đề xuất `.xlsx` nếu duyệt exceljs; else CSV) hay cả `.xlsx`+PDF? Đề xuất **1 format v1**.
- **OQ-3 nội dung**: cột (fullName, durationHuman, method, presentRatio%, segmentCount, unmatchedCount) + header họp; **1 sheet summary v1** [đề xuất], timeline per-person (sheet 2) defer. Xác nhận cột.
- **OQ-4 đồng bộ vs job**: **đồng bộ trong request** [đề xuất] (data nhẹ). Xác nhận.
- **OQ-5 method/approx hiển thị**: có **cột method** + chú thích "approx = xấp xỉ" [đề xuất]. Xác nhận.
- **OQ-6 meeting rỗng/chưa event**: **vẫn xuất** (mọi participant duration 0 + ghi chú "chưa có dữ liệu IVSS") [đề xuất] vs 404. (meeting **không tồn tại** → 404.) Xác nhận.
- **OQ-7 filename**: `ivss-presence-<meeting_code|meetingId>-<YYYYMMDD>.<ext>` [đề xuất]. Xác nhận convention.

## 9. Residuals / known-gaps
- **Số liệu thật phụ thuộc thiết bị** (kế thừa IPD-001): duration/method/presentRatio đúng/sai phụ thuộc eventAction + channel-map + nhịp event thật. Report chỉ **format lại** số liệu sẵn có → nếu nguồn approx/sai, report cũng vậy (cột `method` cảnh báo).
- `method=approx` chiếm đa số ở giai đoạn đầu (eventAction chưa chuẩn) → report phải nêu rõ (OQ-5).
- Nếu thêm lib (OQ-1) → **owed**: cập nhật package.json/lock, license note, smoke test buffer; bundle size (puppeteer rất nặng — cân nhắc).
- Timeline chi tiết per-person (sheet 2 / PDF nhiều trang) defer.
- Localization (tên cột tiếng Việt/Anh, định dạng giờ) — chốt khi plan.
- Seed permission `ivss.presence.read`/`ivss.presence.report`.

> **STOP.** Spec-only. Chờ Thiếu Chủ review + **chốt OQ-1 (lib/dependency) trước tiên** + OQ-2…7, rồi mới plan/tasks.
