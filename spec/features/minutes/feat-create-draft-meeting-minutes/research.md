# Research: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research cho feat-create-draft-meeting-minutes | Toàn bộ file |

## 1. Câu hỏi cần giải quyết trước khi plan

### 1.1 Bảng `meeting_minutes` đã tồn tại chưa?
**Kết luận**: Đã tồn tại trong baseline SQL `database_v3_2_compact_39_tables.sql` (dòng 651-673) và đã có entity `MeetingMinutesEntity` tại `src/modules/minutes/entities/meeting-minutes.entity.ts`, khớp 100% với schema baseline. **Không cần migration tạo bảng mới** (tuân thủ RULE TỐI THƯỢNG 4 / mục 5.4 CLAUDE.md: không tự ý thêm bảng/cột).

### 1.2 Module `minutes` đã có gì?
Chỉ có `minutes.module.ts` (import AccountsModule, MeetingsModule, RecordingModule, TranscriptionModule, đăng ký `TypeOrmModule.forFeature([MeetingMinutesEntity])`) và entity. Chưa có controller/service/DTO — cần tạo mới toàn bộ.
`MinutesModule` đã được đăng ký sẵn trong `app.module.ts` (dòng 30, 104).

### 1.3 Làm sao xác định "Host" của cuộc họp?
`MeetingEntity.hostId` (cột `host_id`, nullable). So sánh trực tiếp `meeting.hostId === authUser.userId`. Pattern này đã dùng nhất quán trong `MeetingsService` (vd. `cancelMeeting`, `updateMeetingRoom`, `getMyScheduleDetail`).

### 1.4 Làm sao lấy danh sách điểm danh thực tế?
Bảng `meeting_participants` (`MeetingParticipantEntity`) có sẵn `attendanceStatus`, `joinedAt`, `leftAt`, `participantRole`. Không cần bảng/join nào khác. Không dùng `presence_snapshots` (đó là dữ liệu camera, khác mục đích).

### 1.5 Cơ chế chống tạo trùng biên bản (idempotency)?
DB không có unique constraint trên `meeting_minutes.meeting_id`. Không được tự ý thêm constraint ngoài yêu cầu rõ ràng (mục 5.4 CLAUDE.md) trong phạm vi feature nhỏ này — decision: kiểm tra tồn tại bằng `SELECT ... WHERE meeting_id = ? AND deleted_at IS NULL FOR UPDATE` bên trong transaction trước khi insert, chấp nhận rủi ro race condition ở mức thấp (rất hiếm khi 2 request tạo đồng thời cho cùng 1 meeting vì chỉ Host mới gọi được). Ghi rõ risk này ở plan.md mục 12. Việc thêm unique index sẽ là một RFC riêng nếu cần (ARCH-01 exception process), ngoài phạm vi feature này.

### 1.6 Pattern permission/guard nào đang dùng?
`JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('<code>')`, decorator `@CurrentUser()`. Permission mới cần seed: `meeting.minutes.create`, theo đúng pattern file `20260618000001-SeedMeetingNotePermissions.ts` (raw SQL qua `queryRunner`, roles: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN).

Lưu ý: các seed file trong `src/database/seeds/` hiện KHÔNG được import/chạy tự động bởi bất kỳ runner nào trong repo (đã kiểm tra, không có script "seed" trong package.json, không có file index import các seed function). Đây là pattern đã tồn tại từ trước (không phải do feature này tạo ra) — seed cần được chạy thủ công (vd. qua một ts-node script ngắn) khi deploy/setup DB. Ghi rõ trong quickstart.md.

### 1.7 Response format chuẩn?
`{ success, message, data }` cho thành công; `{ success: false, message, error: { code, details }, timestamp, path }` cho lỗi (đã có global exception filter xử lý `NotFoundException`/`ForbiddenException`/`ConflictException` với payload object theo đúng convention quan sát được trong `MeetingsService`).

## 2. Rủi ro & quyết định thiết kế

| Rủi ro | Quyết định |
| :--- | :--- |
| Không có unique constraint DB cho 1-minutes-per-meeting | Kiểm tra trong transaction trước insert; chấp nhận rủi ro thấp, ghi chú risk |
| `visibility_level` default của entity là `participants`, không khớp BR1 | Ghi đè cứng thành `private` tại tầng service khi tạo |
| Không có cột lưu "meeting snapshot" (title/time) trong `meeting_minutes` | Không thêm cột; trả trong response DTO bằng cách join/đọc `MeetingEntity` runtime |
| Autosave & update nội dung ngoài phạm vi | Out of scope, ghi rõ trong spec mục 8 |

## 3. Kết luận
Không có unknown nào chặn việc viết plan.md. Tiến hành Phase 1.
