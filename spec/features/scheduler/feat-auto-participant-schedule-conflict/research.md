# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới research.md cho UC-SM-04 | Toàn bộ file |

---

# Research: Participant Conflict Check (UC-SM-04)

## Codebase Analysis

### Existing Patterns

**SchedulingModule** (src/modules/scheduling/):
- Đã có controller, service, DTOs cho room suggestion (UC-50/UC-SM-01).
- Dùng TypeOrmModule.forFeature thay vì import module khác (tránh circular dependency).
- Dùng @InjectEntityManager() + EntityManager — không dùng Repository pattern.
- Validation: class-validator DTO + ValidationPipe (whitelist + transform + forbidNonWhitelisted).
- Auth: JwtAuthGuard + PermissionsGuard + @RequirePermissions('...').

**MeetingRequestEntity** (src/modules/meetings/entities/meeting-request.entity.ts):
- Đã có sẵn: conflictCheckStatus (enum: NOT_CHECKED / CLEAR / WARNING / BLOCKED).
- Đã có sẵn: conflictCheckedAt (timestamptz, nullable).
- Đã có sẵn: conflictSummaryJson (jsonb, nullable).
- **Không cần thay đổi schema** — spec khẳng định database v3.2 Compact đã đáp ứng.

**MeetingEntity**:
- status enum: DRAFT, PENDING_APPROVAL, SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED.
- Soft delete: deleted_at.
- Conflict detection loại trừ: COMPLETED, CANCELLED + soft deleted.

**MeetingParticipantEntity**:
- meeting_id, user_id.
- Dùng để lookup participant schedule.

### Technology Decisions

| Decision | Chọn | Lý do |
|---|---|---|
| Conflict detection method | TypeORM QueryBuilder, tính động | Không có bảng schedule_conflicts; dữ liệu từ meetings + meeting_participants |
| Realtime check | Stateless, đồng bộ trong request | WebSocket không cần thiết cho request-response check; không lưu state |
| Submit re-check | Service method riêng, gọi từ MeetingsService | MeetingsService tạo request → gọi SchedulingService check → ghi snapshot |
| Auth | Permission scheduling.conflict.participant.check | Permission đã có sẵn trong API Contract (Phụ lục A). Cần seed vào DB |
| External participant | Chỉ trả unknown, không check | Không có tài khoản nội bộ → không có lịch |

### Risks

- **Performance**: Nếu participant list lớn (>50), cần batch/limit. Spec giới hạn 50.
- **Privacy**: Phải đảm bảo response không leak title/description/room. Dùng DTO mapping, không expose entity.
- **IDOR**: excludeMeetingId — phải kiểm tra user có quyền truy cập meeting đó.
