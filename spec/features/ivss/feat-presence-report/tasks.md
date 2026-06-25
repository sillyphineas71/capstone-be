# IPR-001 — tasks.md (#43 IVSS presence report PDF)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo tasks IPR-001: T0 dep+font → T1 report service (pdfkit render) → T2 endpoint @Res → T3 wiring → tests → T-GATE. pdfkit→PDF, read-only, no-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. READ-ONLY.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T-GATE.

---

## T0 — Dependency + font asset (C3, C1) — plan §1/§2
- `npm install pdfkit` (dep) + `npm install -D @types/pdfkit`. Ghi **version cài thực tế** + xác nhận transitive deps MIT/tự do (fontkit/linebreak/png-js…); **lạ/nặng bất thường → DỪNG báo**.
- Commit font `assets/fonts/NotoSans-Regular.ttf` (OFL-1.1) vào repo (binary). Verify đọc được qua `path.join(process.cwd(),'assets','fonts','NotoSans-Regular.ttf')` (tồn tại + readable).
- `npm run build` = 0.
- **AC**: dán pdfkit version + license; font file tồn tại; build 0. (Dep/transitive bất thường → DỪNG, KHÔNG tiếp.)

## T1 — IvssPresenceReportService (code) — plan §3, OQ-3/5/6/7, C1, C4
- `buildMeetingReport(meetingId)`: `getMeetingPresence` (null→return null) + header query (bind) → `renderPdf` → `{buffer, filename}` (filename OQ-7).
- `renderPdf`: PDFDocument, `doc.font(FONT_PATH)` TRƯỚC render (C1); header họp + chú thích method (OQ-5) + bảng người vẽ tay (cột OQ-3) + OQ-6 dòng "Chưa có dữ liệu IVSS" khi rỗng/0; collect chunks → Buffer.
- Helpers `durationHuman`/`fmtRatio`/`fmtTime`. SEC-01 KHÔNG ảnh. C4 chỉ SELECT.
- **AC**: summary giả → buffer bắt đầu `%PDF`, filename đúng; meeting null → trả null.

## T1b — report service test — C1, OQ-6, SEC-01
- buffer>0 + `%PDF`; **C1** fullName='Trần Đức Hải' → KHÔNG throw; OQ-6 summary rỗng/duration 0 → vẫn buffer; null meeting → null; SEC payload service không nhận imageBase64.
- **AC**: ≥80% nhánh report service.

## T2 — Endpoint report @Res (code) — plan §4, C2, SEC-02
- `ivss-presence.controller.ts` thêm `GET :meetingId/presence/report`: `JwtAuthGuard+MockPermissionsGuard`, `@Permissions('ivss.presence.read')`, `ParseUUIDPipe`, `@Res() res`. `buildMeetingReport` null → 404 (KHÔNG chạm res.send); buffer → `Content-Type application/pdf` + `Content-Disposition attachment; filename` + `res.send(buffer)`; lỗi render → `res.status(500).end()` KHÔNG lộ path. KHÔNG envelope.
- **AC**: buffer → header download đúng; meeting không tồn tại → 404; lỗi → 500 không lộ path.

## T2b — controller test — C2, SEC-02
- mock res (setHeader/send/status); buffer → Content-Type/Disposition set + send gọi; null → 404; service throw → 500 (.end, không lộ path); guard JwtAuthGuard metadata.
- **AC**: các ca xanh.

## T3 — Wiring (code) — plan §5
- `ivss.module.ts`: provider `IvssPresenceReportService`.
- **AC**: build resolve DI; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies).

## T-GATE — (STOP, KHÔNG commit) — plan §7
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`/`ivss-presence.controller.ts`/`package.json`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% `ivss-presence-report.service.ts`; **C4 grep read-only** (INSERT/UPDATE/DELETE rỗng file mới); DI-proof; npm-install + build pass; font load OK. **KHÔNG live.**
- **Owed**: số liệu phụ thuộc thiết bị + `method=approx` cảnh báo (kế thừa IPD-001); seed permission `ivss.presence.read`; cwd-assumption font (residual).
- **AC**: bảng gate + báo cáo: pdfkit version+license · font VN render (C1, tên có dấu OK) · @Res no-envelope + 404 + 500-no-path (C2) · read-only grep (C4) · tái dùng getMeetingPresence (ARCH-01) · coverage · DI-proof. STOP.

## Map task → scope #43
- T0 → dep pdfkit + font (C3/C1)
- T1/T1b → format PDF (tái dùng IPD-001, OQ-3/5/6/7)
- T2/T2b/T3 → endpoint download admin-gated (C2) + wiring
