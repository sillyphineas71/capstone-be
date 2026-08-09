# Specification Quality Checklist: Dashboard Chart APIs (Security Alerts Daily Trend + Audit Activity Hourly)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-09
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details trong phần Requirements
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers còn sót — các điểm mơ hồ đã được diễn giải và ghi quyết định rõ ràng ở §0 RECON (đơn vị đếm alert theo `triggered_at`, `byType` chỉ liệt kê type > 0, permission riêng theo convention `analytics.*`)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] All acceptance scenarios are defined (happy path, validation, authorization, business rule)
- [x] Edge cases are identified (ngày/giờ không có dữ liệu → zero-fill, tổng bằng 0 toàn kỳ)
- [x] Scope is clearly bounded (§8 Out of Scope: không sửa FE, không cache, không cộng dồn occurrence)
- [x] Dependencies and assumptions identified (§1.4)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria (traceability §7.5)
- [x] User scenarios cover Business Admin (API 1) và System Admin (API 1 + API 2)
- [x] Feature meets measurable outcomes của tài liệu FE gốc (2 endpoint đúng response shape yêu cầu)
- [x] No implementation details leak into specification

## Notes

- Đã RECON đối chiếu tài liệu FE với code FE thật (`FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx`) trước khi viết spec — xác nhận tài liệu hợp lệ, ghi nhận 2 điểm lệch phía FE không thuộc phạm vi BE.
- Quyết định quan trọng nhất: group cảnh báo theo `triggered_at` (không phải `last_seen_at`) do cơ chế dedup của `security_alerts` — có trade-off đã ghi rõ ở CL-1.
- Không đề xuất bảng/cột database mới — chỉ thêm seed permission qua migration (bắt buộc theo CLAUDE.md mục 5.5 quy tắc #4).
- Out of Scope có EARS guardrails (OOS-001..004).
- Đã xác nhận field/entity/enum bằng cách đọc trực tiếp source code (`security-alert.entity.ts`, `audit-log.entity.ts`, `create-alert-rule.dto.ts`), không suy đoán.
- Đã kiểm tra thực tế `db_schema.sql`: `audit_logs`/`security_alerts` chưa có index riêng trên `created_at`/`triggered_at` — ghi nhận là rủi ro chấp nhận được ở quy mô hiện tại, không tự ý thêm index ngoài yêu cầu.
