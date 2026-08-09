---
description: "Task list for AA-DASHBOARD-CHARTS-001"
---

# Tasks: Dashboard Chart APIs (Security Alerts Daily Trend + Audit Activity Hourly)

**Input**: Design documents from `spec/features/analytics/feat-view-dashboard-security-audit-charts/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/

**Tests**: Có — unit test cho service theo yêu cầu NFR-017-style của repo (test success flow + validation + authorization).

**Organization**: 2 user story độc lập, mỗi story = 1 endpoint hoàn chỉnh.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Có thể chạy song song (file khác nhau, không phụ thuộc nhau)
- **[Story]**: US1 = Security Alerts Daily Trend, US2 = Audit Activity Hourly

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Seed permission — bắt buộc trước khi bất kỳ controller nào hoạt động đúng (nếu không sẽ 403 cho mọi role, kể cả role hợp lệ).

- [x] T001 Tạo migration `src/database/migrations/20260809000001-SeedAnalyticsDashboardChartPermissions.ts` seed `analytics.security_alerts.read` (roles `BUSINESS_ADMIN, SYSTEM_ADMIN`) và `analytics.audit_activity.read` (role `SYSTEM_ADMIN`), theo đúng pattern idempotent của `20260723000006-SeedSecurityAlertPermissions.ts`.

**Checkpoint**: Permission đã sẵn sàng — US1/US2 có thể triển khai song song.

---

## Phase 2: User Story 1 - Security Alerts Daily Trend (Priority: P1) 🎯 MVP

**Goal**: `GET /analytics/security-alerts/daily-trend` trả về `series` theo ngày (đủ `days` phần tử, zero-fill) + `byType` + `totalInPeriod`, đúng permission `analytics.security_alerts.read`.

**Independent Test**: Gọi API với JWT của `BUSINESS_ADMIN`/`SYSTEM_ADMIN`, không truyền `days` → nhận `series` đủ 7 phần tử, `totalInPeriod` khớp tổng.

### Tests for User Story 1

- [x] T002 [P] [US1] Unit test `src/modules/analytics/tests/security-alerts-daily-trend.service.spec.ts`: happy path (zero-fill, byType chỉ liệt kê type>0), `days` mặc định/biên 1-30, validation error, tổng `totalInPeriod` khớp `SUM(series.total)`.

### Implementation for User Story 1

- [x] T003 [P] [US1] Tạo `src/modules/analytics/dto/query-security-alerts-daily-trend.dto.ts` — field `days?: number`, `@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(30)`.
- [x] T004 [P] [US1] Tạo `src/modules/analytics/dto/security-alerts-daily-trend-response.dto.ts` — `SecurityAlertsDailyTrendResponseDto { series: DailyTrendPointDto[]; totalInPeriod: number }`, `DailyTrendPointDto { date: string; total: number; byType: Record<string, number> }`.
- [x] T005 [US1] Tạo `src/modules/analytics/repositories/security-alerts-daily-trend.repository.ts` — raw SQL `GROUP BY (triggered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, alert_type` trong khoảng `[fromUtc, toUtcExclusive)`, dùng `DataSource.query()` parameterized (mirror `AuditLogQueryRepository`).
- [x] T006 [US1] Tạo `src/modules/analytics/services/security-alerts-daily-trend.service.ts` — resolve khoảng ngày UTC+7 từ `days`, gọi repository, zero-fill `series` đủ `days` phần tử, tính `totalInPeriod`, ghi audit log non-blocking `read_analytics_security_alerts_daily_trend` qua `AuditLogsService.logAction()` (try/catch, không chặn response nếu lỗi).
- [x] T007 [US1] Tạo `src/modules/analytics/controllers/security-alerts-daily-trend.controller.ts` — `@Controller('analytics/security-alerts')`, `@Get('daily-trend')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.security_alerts.read')`, `ValidationPipe({whitelist:true, transform:true})`, response `{success, message, data, meta}`, bắt `HttpException` rethrow + fallback `InternalServerErrorException`.

**Checkpoint**: US1 hoạt động độc lập, test được ngay.

---

## Phase 3: User Story 2 - Audit Activity Hourly (Priority: P2)

**Goal**: `GET /analytics/audit-activity/hourly` trả về `buckets` đủ 24 phần tử (zero-fill) + `totalToday`, đúng permission `analytics.audit_activity.read` (chỉ `SYSTEM_ADMIN`).

**Independent Test**: Gọi API với JWT của `SYSTEM_ADMIN`, không truyền `date` → nhận `buckets` đủ 24 phần tử cho hôm nay, `totalToday` khớp tổng.

### Tests for User Story 2

- [x] T008 [P] [US2] Unit test `src/modules/analytics/tests/audit-activity-hourly.service.spec.ts`: happy path (zero-fill 24 bucket), `date` mặc định = hôm nay, validation error định dạng ngày, tổng `totalToday` khớp `SUM(buckets.count)`.

### Implementation for User Story 2

- [x] T009 [P] [US2] Tạo `src/modules/analytics/dto/query-audit-activity-hourly.dto.ts` — field `date?: string`, `@IsOptional() @IsDateString()`.
- [x] T010 [P] [US2] Tạo `src/modules/analytics/dto/audit-activity-hourly-response.dto.ts` — `AuditActivityHourlyResponseDto { date: string; buckets: HourlyBucketDto[]; totalToday: number }`, `HourlyBucketDto { hour: string; count: number }`.
- [x] T011 [US2] Tạo `src/modules/analytics/repositories/audit-activity-hourly.repository.ts` — raw SQL `GROUP BY EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')` trong khoảng `[dayStartUtc, dayEndUtcExclusive)`, dùng `DataSource.query()` parameterized.
- [x] T012 [US2] Tạo `src/modules/analytics/services/audit-activity-hourly.service.ts` — resolve ngày UTC+7 từ `date` (mặc định hôm nay), validate format, gọi repository, zero-fill 24 `buckets`, tính `totalToday`, ghi audit log non-blocking `read_analytics_audit_activity_hourly`.
- [x] T013 [US2] Tạo `src/modules/analytics/controllers/audit-activity-hourly.controller.ts` — `@Controller('analytics/audit-activity')`, `@Get('hourly')`, `@RequirePermissions('analytics.audit_activity.read')`, cùng convention response/error như US1.

**Checkpoint**: US1 + US2 đều hoạt động độc lập.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [x] T014 Đăng ký `SecurityAlertsDailyTrendController`, `AuditActivityHourlyController` vào `controllers[]` và 2 service + 2 repository vào `providers[]` của `src/modules/analytics/analytics.module.ts`.
- [x] T015 Chạy `npm run lint` + `npm run build` + `npm test -- analytics` để xác nhận không phá vỡ các test/feature analytics hiện có.
- [x] T016 Cập nhật CHANGELOG của `CLAUDE.md` nếu có sửa nội dung liên quan (theo RULE TỐI THƯỢNG 2) — **không sửa CLAUDE.md** trong feature này vì không thay đổi kiến trúc/module list đã mô tả (chỉ thêm endpoint con trong module `analytics` đã có sẵn trong bảng 4.1).

---

## Dependencies & Execution Order

- **Phase 1 (Foundational)**: Không phụ thuộc — chạy trước tiên, BLOCK cả US1 và US2 (thiếu permission → 403 dù code đúng).
- **US1 (P1)** và **US2 (P2)**: Độc lập hoàn toàn (file khác nhau, permission khác nhau) — có thể làm song song sau Phase 1.
- **Phase 4 (Polish)**: Phụ thuộc cả US1 và US2 hoàn tất (cần cả 2 controller mới để đăng ký module).

## Notes

- [P] tasks = file khác nhau, không phụ thuộc nhau.
- Không có task nào đụng chung 1 file giữa US1/US2 ngoại trừ T014 (đăng ký module) — cố ý để cuối cùng, sau khi cả 2 controller đã tồn tại.
- Test viết trước implementation theo đúng khuyến nghị template, nhưng vì đây là 2 hàm thuần tính toán (không phụ thuộc I/O phức tạp), có thể viết song song với service nếu cần — không bắt buộc red-green nghiêm ngặt như TDD cho feature Medium priority này.
