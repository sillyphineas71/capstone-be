# ASM-001 — tasks.md (3d Alerts / SAVP: hợp nhất nguồn cảnh báo cũ)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ASM-001: T0 verify (bắt buộc UC-122+UC-123 đã xong) → T1 sửa VehicleControlAlertService → T1b test → T2 sửa StrangerAlertService → T2b test → T3 wiring module → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. **Điều kiện tiên quyết cứng: `../uc122-alert-rules-crud/` và `../uc123-alert-center/` PHẢI code + gate xanh trước khi bắt đầu T0 ở đây.**

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `AlertRulesService.findEffectiveRule` + `AlertsService.recordAlert` ĐÃ tồn tại thật trong code (không phải chỉ trong spec) — build/test 2 cụm đó đã xanh.
- Xác nhận constructor thật của `VehicleControlAlertService`/`StrangerAlertService`, `imports` thật của `AnprModule`/`FaceAccessModule`.
- **AC**: dán xác nhận đủ; UC-122/UC-123 CHƯA xong → **DỪNG**, không code 3d trước.

## T1 — Sửa `VehicleControlAlertService` (code) — plan §3
- Thêm 2 constructor param, đoạn gọi `findEffectiveRule`→`recordAlert` đúng vị trí + try/catch NotThrow.
- **AC**: `resolveRecipients()`/`createNotification()` GIỮ NGUYÊN 100% (diff chỉ thêm dòng, không sửa dòng cũ trừ constructor).

## T1b — Test `VehicleControlAlertService` — plan §7
- 3 case: suppressed / thành công (thứ tự gọi + severity đúng) / recordAlert lỗi (NotThrow).
- **AC**: test cũ (throttle, no-recipient...) KHÔNG hồi quy; 3 case mới xanh.

## T2 — Sửa `StrangerAlertService` (code) — plan §4
- Tương tự T1, đúng vị trí trong `onStranger()`.
- **AC**: WS + `resolveAdmins()` + notification + email opt-in GIỮ NGUYÊN 100% (KHÔNG sửa bug `role_code`).

## T2b — Test `StrangerAlertService` — plan §7
- 3 case tương tự T1b, thêm assert WS KHÔNG bị gọi khi suppressed.
- **AC**: test cũ KHÔNG hồi quy; 3 case mới xanh.

## T3 — Wiring module (code) — plan §5
- Thêm `AlertsModule` vào `imports` của `AnprModule`/`FaceAccessModule` (nếu chưa có).
- **AC**: `AppModule` compile được (DI-proof), KHÔNG circular.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint 0 warning mới; `npx jest src/modules/anpr src/modules/face-access src/modules/alerts` xanh; coverage phần sửa ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: diff 4 file modified + jest + coverage + báo cáo gate.
- **Owed**: bug `role_code='admin'` · `zoneId` thật · `sourceEventId` thật · cảnh báo camera offline.
- **AC**: bảng gate đầy đủ + báo cáo: suppressed dừng cả recordAlert+notification (vehicle) / cả recordAlert+WS+notification (stranger) ✓ · NotThrow khi recordAlert lỗi ✓ · notification/WS cũ không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope 3d
- T0 → verify RECON + xác nhận UC-122/UC-123 đã xong
- T1/T1b → sửa + test VehicleControlAlertService
- T2/T2b → sửa + test StrangerAlertService
- T3 → wiring module
- T-GATE → gate + STOP + Owed
