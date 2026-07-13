# Task List: AI Draft Feature Availability (MKM-AI-03)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo tasks cho feat-ai-draft-feature-flag theo plan.md (2026-07-13) — 4 task, 1 phase | Toàn bộ file |
| 2026-07-13 | ✅ Hoàn thành T001–T004: DTO `AiDraftConfigDto`, service `getAiDraftAvailability` (tái dùng nguyên `loadConfig`/`userHasAdminRole`), controller `GET /meetings/:meetingId/minutes/ai-draft-config`, 6 unit test (AC-001→006). `npx jest src/modules/minutes` = 9 suites / 157 tests pass; build sạch. **FEATURE MKM-AI-03 HOÀN TẤT 4/4 TASK** | Checklist T001–T004, DoD |

**Input**: [spec.md](./spec.md) (2026-07-13), [plan.md](./plan.md) (2026-07-13)

## Checklist

- [x] T001 DTO response → `src/modules/minutes/dto/ai-draft-config.dto.ts`
- [x] T002 Service `getAiDraftAvailability` (tái dùng `loadConfig`/`userHasAdminRole`) → `src/modules/minutes/services/minutes-ai-draft.service.ts`
- [x] T003 Controller `GET /meetings/:meetingId/minutes/ai-draft-config` → `src/modules/minutes/controllers/minutes-ai-draft.controller.ts`
- [x] T004 Unit test 6 case (AC-001→006) → `src/modules/minutes/services/minutes-ai-draft.service.spec.ts`

> **Điểm dừng an toàn**: sau T004 — feature hoàn tất trong 1 phase (scope nhỏ, không cần checkpoint trung gian).

## Definition of Done

- [x] Tất cả AC (spec mục 7) có test pass.
- [x] `npx jest src/modules/minutes` xanh (9 suites / 157 tests); build `tsconfig.build.json` sạch.
- [x] Docs đầy đủ + CHANGELOG cập nhật khi hoàn thành.
- [x] Không đổi DB/seed/worker.
- [ ] WIP local — không tự push (kế thừa MKM-AI-01/02).
