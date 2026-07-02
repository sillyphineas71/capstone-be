# Requirements Quality Checklist: List Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo checklist cho feat-list-meeting-minutes | Toàn bộ file |

## Content Quality
- [x] Mọi FR đều dùng cú pháp EARS (THE/WHEN/WHILE/WHERE/IF-THEN).
- [x] Không có yêu cầu mơ hồ ("nên", "có thể" không dùng cho hard rule).
- [x] Business rule gốc UC-MKM-02 (BR2 — pagination max 20) được ánh xạ vào FR-006/FR-026.

## Requirements Completeness
- [x] Có traceability 2 chiều: UC gốc/thảo luận → FR (3.9), FR → AC (7.6).
- [x] Có đủ Error Handling cho: validation, authn/authz, system failure.
- [x] Scope theo role (draft riêng tư, published/archived theo participant, admin bypass) được đặc tả rõ (FR-014 → FR-016) và có AC riêng cho từng nhánh (AC-001 → AC-005).
- [x] Out of Scope liệt kê rõ các use case liên quan sẽ tách riêng (detail, publish, export).

## Readiness for Planning
- [x] Không còn unknown chặn plan (xem research.md mục 3).
- [x] Không yêu cầu thêm bảng/cột DB mới (đã xác minh qua entity hiện có).
- [x] Đã xác định rõ permission code mới cần seed (`meeting.minutes.read`) và cơ chế đúng (migration, không dùng seeds/).
- [x] 2 điểm cần làm rõ ban đầu của UC-MKM-02 đã được thảo luận và chốt với người dùng trước khi viết spec (xem mục 1.5 spec.md).
- [x] Điểm còn defer (`visibility_level=department/public_internal`) đã có fallback fail-closed rõ ràng, không chặn implementation.

## Kết luận
Spec đạt chất lượng để chuyển sang Plan/Tasks/Implementation.
