# Implementation Plan: Dashboard Chart APIs (Security Alerts Daily Trend + Audit Activity Hourly)

**Branch**: `feat/analytics-dashboard-charts` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `spec/features/analytics/feat-view-dashboard-security-audit-charts/spec.md`

## Summary

Bổ sung 2 endpoint read-only vào module `analytics` hiện có, phục vụ Dashboard SysAdmin của FE: (1) `GET /analytics/security-alerts/daily-trend` — xu hướng cảnh báo an ninh theo ngày, phân theo loại, N ngày gần nhất; (2) `GET /analytics/audit-activity/hourly` — số lượng audit log theo từng giờ trong 1 ngày. Cả 2 API đều on-demand aggregation qua raw SQL parameterized (mirror pattern `AuditLogQueryRepository`), zero-fill bucket ở tầng service, ghi audit log non-blocking theo pattern `on-time-rate.service.ts`. Không thêm bảng/cột database — chỉ seed 2 permission mới qua migration.

## Technical Context

**Language/Version**: TypeScript (NestJS, Node.js LTS)
**Primary Dependencies**: NestJS, TypeORM (`DataSource.query` raw SQL), class-validator/class-transformer, `@nestjs/swagger`
**Storage**: PostgreSQL — bảng có sẵn `security_alerts`, `audit_logs` (không tạo bảng mới)
**Testing**: Jest — unit test cho service (mock repository) + repository (mock DataSource nếu cần), theo pattern `*.service.spec.ts` sẵn có trong `analytics/tests/` và `administration/tests/`
**Target Platform**: Backend NestJS modular monolith hiện có
**Project Type**: Web service (mở rộng module `analytics` đã tồn tại)
**Performance Goals**: NFR-001 — phản hồi < 2s cho `days<=30` hoặc 1 ngày `buckets`, tải bình thường
**Constraints**: Không tạo bảng/cột/config key mới; không cache/pre-aggregate; timezone tính toán cố định `Asia/Ho_Chi_Minh`
**Scale/Scope**: 2 endpoint GET, không có write path, không có UI (BE only — FE tự tích hợp sau)

## Constitution Check

*GATE: Đối chiếu CLAUDE.md — không có file constitution.md riêng trong `.specify/memory/` cho dự án này ngoài CLAUDE.md/AGENTS.md.*

- ✅ Dùng TypeORM (raw SQL qua `DataSource`, không dùng Prisma) — đúng mục 3.1/RULE TỐI THƯỢNG 4.
- ✅ Không thêm bảng/cột database mới — đúng mục 5.4.
- ✅ Đặt code trong module `analytics/` đã tồn tại, không tạo module mới — đúng mục 3.2 (modular monolith).
- ✅ Response convention `{success, message, data, meta}` — đúng mục 8.1.
- ✅ Permission mới seed bằng migration cùng commit với controller — đúng mục 5.5 quy tắc #4 (áp dụng chung cho mọi endpoint mới, không riêng SAVP).
- ✅ Route dùng `GET`, resource danh từ số nhiều/rõ nghĩa (`security-alerts`, `audit-activity`) — đúng mục 7.3.

Không có vi phạm cần Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-dashboard-security-audit-charts/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md          # Phase 1 output
├── contracts/
│   ├── security-alerts-daily-trend-api.md
│   └── audit-activity-hourly-api.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                                   # [MODIFIED] đăng ký 2 controller/service/repository mới
├── controllers/
│   ├── security-alerts-daily-trend.controller.ts         # [NEW] GET /analytics/security-alerts/daily-trend
│   └── audit-activity-hourly.controller.ts                # [NEW] GET /analytics/audit-activity/hourly
├── services/
│   ├── security-alerts-daily-trend.service.ts             # [NEW]
│   └── audit-activity-hourly.service.ts                    # [NEW]
├── repositories/
│   ├── security-alerts-daily-trend.repository.ts           # [NEW] raw SQL trên security_alerts
│   └── audit-activity-hourly.repository.ts                  # [NEW] raw SQL trên audit_logs
├── dto/
│   ├── query-security-alerts-daily-trend.dto.ts             # [NEW]
│   ├── security-alerts-daily-trend-response.dto.ts          # [NEW]
│   ├── query-audit-activity-hourly.dto.ts                    # [NEW]
│   └── audit-activity-hourly-response.dto.ts                  # [NEW]
└── tests/
    ├── security-alerts-daily-trend.service.spec.ts          # [NEW]
    └── audit-activity-hourly.service.spec.ts                  # [NEW]

src/database/migrations/
└── 20260809000001-SeedAnalyticsDashboardChartPermissions.ts  # [NEW] seed 2 permission mới
```

**Structure Decision**: Mở rộng module `analytics/` đã tồn tại theo đúng convention thư mục con `controllers/services/repositories/dto/tests` đã dùng cho toàn bộ 10 feature analytics khác (không tạo module/thư mục cấu trúc mới).

## Complexity Tracking

*Không có vi phạm Constitution Check cần biện minh — bảng để trống theo đúng hướng dẫn template.*
