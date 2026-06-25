# Research - Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

## Codebase Analysis

### 1. Module hiện tại

| Module | Trạng thái | Liên quan |
|--------|-----------|-----------|
| meetings/ | Đã implement (controller + service + 8 entities) | Chứa MeetingRequestEntity - entity chính |
| scheduling/ | Module rỗng | Không dùng, logic gộp trong meetings service |
| accounts/ | UserEntity sẵn sàng | Relation requestedBy |

### 2. Entities có sẵn và dùng được ngay

- **MeetingRequestEntity**: Đầy đủ fields (requestCode, approvalStatus, requestType, requestedBy, requestedAt, targetRoomId, requestedStartTime, requestedEndTime, conflictCheckStatus, conflictSummaryJson, decisionBy, decisionAt, rejectionReason)
- **UserEntity**: Dùng cho relation requestedByUser
- **RoomEntity**: Dùng cho relation targetRoom
- **MeetingEntity**: Dùng cho relation meeting

### 3. Patterns có sẵn

| Pattern | Implementation |
|---------|---------------|
| Controller | meetings.controller.ts với module prefix |
| Guard | JwtAuthGuard + PermissionsGuard + @RequirePermissions() |
| Response format | { success, message, data, meta } |
| Error format | NestJS exception filter với { success, message, error: { code, details } } |
| Pagination | Query params page, limit, sortBy, sortOrder |
| Sort allowlist | Validate trước khi dùng orderBy |
| DTO validation | class-validator + class-transformer |
| Permission check | AuthzReadRepository.getEffectiveRolesAndPermissions(userId) — returns { roles: string[], permissions: string[] } |

### 4. Chưa có (cần tạo mới)

- **MeetingRequestsController** - chưa có controller riêng
- **Meeting request list endpoint** - chưa có GET /meeting-requests
- **Method findMeetingRequests()** trong MeetingsService
- **DTOs** cho query params + response

## Technology Decisions

| Decision | Chọn | Rationale |
|----------|------|-----------|
| Module placement | meetings module | Entity đã có, pattern có sẵn |
| Controller | Controller riêng meeting-requests.controller.ts | Resource riêng biệt |
| Query approach | TypeORM QueryBuilder + LEFT JOIN | Tránh N+1, index-friendly |
| Pagination | skip + take + getManyAndCount() | Pattern dự án |
| Sort allowlist | Mảng string ['requested_at','created_at','approval_status','request_type'] | Validate trước orderBy |
| Scope filtering | QueryBuilder .where() + subquery | Manager/Approver: directManagerId hoặc department manager_user_id |
| Permission | @RequirePermissions('meeting_request.read') | Guard check permission; service scope filter dùng AuthzReadRepository.getEffectiveRolesAndPermissions() + roles.some() |
| Null relation | LEFT JOIN + null check + map DTO | Tránh lỗi null pointer |
| conflictSummary | Raw JSON từ conflict_summary_json | Không mutate, không normalize |
| Audit log | Không ghi | Feature read-only |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| N+1 query | QueryBuilder LEFT JOIN + select fields cụ thể |
| SortBy injection | Allowlist validation trước orderBy |
| Scope filtering phức tạp | Tách scope logic thành method riêng |
| Large result set | Pagination bắt buộc, limit <= 100 |
| Room manager scope chưa có | Defer - không invent schema mới |
