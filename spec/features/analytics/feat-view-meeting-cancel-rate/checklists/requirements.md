# Specification Quality Checklist: Xem thống kê tỷ lệ cuộc họp bị hủy

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-02
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details trong phần Requirements
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers còn sót — toàn bộ điểm mơ hồ đã liệt kê, đề xuất phương án, người dùng duyệt 4 quyết định chính (endpoint gộp vào UC-154, ranking theo organizer, 2 danh sách Top-10 riêng, bucket theo `start_time`) trước khi viết spec (§0 RECON); các điểm còn lại chốt theo phương án khuyến nghị không bị phản đối
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] All acceptance scenarios are defined (happy path, validation, authorization, business rule)
- [x] Edge cases are identified (ngưỡng chống nhiễu ranking, organizer vs actor hủy, Manager không có `topDepartments`, `organizerEmail` không khớp user nào)
- [x] Scope is clearly bounded (§8 Out of Scope: không tách endpoint riêng cho Top-10, không ranking theo actor, không cấu hình ngưỡng qua UI)
- [x] Dependencies and assumptions identified (§1.4)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria (traceability §3.10, §7.4)
- [x] User scenarios cover Manager/Business Admin/System Admin
- [x] Feature meets measurable outcomes UC-AA-07 (biểu đồ xu hướng tỷ lệ hủy + bảng xếp hạng cảnh báo)
- [x] No implementation details leak into specification

## Notes

- Khoảng trống lớn nhất được phát hiện qua RECON: `API_CONTRACT` UC-154 hoàn toàn không có phần Top-10 ranking dù Normal Flow bước 5 yêu cầu rõ — đã quyết định mở rộng response endpoint hiện có (§0.1) thay vì tách endpoint mới, tránh FE phải gọi 2 API cho 1 màn hình.
- Điểm quan trọng nhất đã chốt cùng người dùng: ranking Top-10 tính theo **organizer** (người tổ chức có lịch bị hủy), không phải theo actor thực hiện hành động hủy — vì code xác nhận `meeting.cancel.any` cho phép người khác hủy hộ, và actor hủy không có cột riêng đáng tin cậy (`updated_by` bị dùng chung cho mọi update khác).
- Bổ sung ngưỡng tối thiểu `organizedCount >= 3` để vào bảng xếp hạng — không có trong BR gốc, là suy luận hợp lý chống nhiễu tỷ lệ 100% trên mẫu quá nhỏ (1-2 lịch).
- `topDepartments` luôn rỗng với role MANAGER (do phạm vi chỉ có 1 phòng ban, xếp hạng phòng ban vô nghĩa) — quyết định riêng cho feature này, khác các UC-AA trước.
- Không đề xuất bảng/cột/config/permission mới — tái dùng 100% hạ tầng từ UC-AA-01/04/05/06.
- Out of Scope có EARS guardrails (OOS-001..004).
- Đã ghi rõ các điểm lệch với `API_CONTRACT` UC-154 gốc (`preset`, `granularity`, `organizerEmail`, `topOrganizers`, `topDepartments` đều là bổ sung mới) kèm đề xuất đồng bộ tài liệu.
