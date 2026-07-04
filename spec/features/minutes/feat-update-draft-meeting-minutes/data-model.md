# Data Model: Update Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-update-draft-meeting-minutes | Toàn bộ file |

## 1. Bảng liên quan (không có bảng/cột mới)

### 1.1 `meeting_minutes` (đọc + ghi, entity đã tồn tại: `MeetingMinutesEntity`)
| Column | Feature này | Ghi chú |
| :--- | :--- | :--- |
| `id` | Đọc (điều kiện WHERE) | Path param `:id` |
| `meeting_id` | Đọc | Dùng để join `meetings`/`meeting_participants` |
| `title` | Đọc + Ghi (optional) | Ghi đè nếu request có `title` |
| `version_no` | Đọc + Ghi | So khớp optimistic lock, `+1` sau khi ghi |
| `status` | Đọc (điều kiện) | Chỉ cho ghi khi `= draft`; KHÔNG bị feature này thay đổi |
| `minutes_content` | Đọc + Ghi (optional) | Ghi đè nếu request có `minutesContent` |
| `attendees_snapshot_json` | Đọc + Ghi (có điều kiện) | Chỉ ghi lại (refresh) khi `meeting.status = completed` |
| `decisions_json` | Đọc + Ghi (optional) | Ghi đè toàn bộ mảng nếu request có `decisionsJson` (không merge phần tử) |
| `action_items_json` | Đọc + Ghi (optional) | Ghi đè toàn bộ mảng nếu request có `actionItemsJson`; server tự sinh `id` cho phần tử thiếu `id` |
| `prepared_by` | Đọc (điều kiện ownership) | Không đổi |
| `updated_at` | Ghi (tự động) | `@UpdateDateColumn`, không set thủ công |

### 1.2 `meetings` (chỉ đọc, entity: `MeetingEntity`)
Đọc `host_id` (ownership rule) và `status` (điều kiện refresh snapshot). Không ghi.

### 1.3 `meeting_participants` (chỉ đọc, entity: `MeetingParticipantEntity`)
Chỉ đọc khi `meeting.status = completed`, lấy `userId, participantRole, attendanceStatus, joinedAt, leftAt` để dựng lại `attendeesSnapshotJson` — cùng shape với `MinutesAttendeeSnapshot` đã định nghĩa trong `draft-minutes-response.dto.ts`.

### 1.4 `audit_logs` (chỉ ghi, entity: `AuditLogEntity`, qua `AuditLogsService.logEntityChange`)
1 dòng/lần update thành công: `action_type=meeting_minutes_updated`, `entity_type=meeting_minutes`, `entity_id=<minutesId>`, `old_value_json={versionNo: <cũ>}`, `new_value_json={versionNo: <mới>, updatedFields: [...]}`.

## 2. Shape JSON có cấu trúc

### 2.1 `decisions_json` (mảng `DecisionItem`)
```ts
interface DecisionItem {
  decision: string;              // required, max 500 ký tự
  responsibleUserId: string | null; // optional, uuid — KHÔNG bắt buộc là participant của meeting
}
```

### 2.2 `action_items_json` (mảng `ActionItem`)
```ts
interface ActionItem {
  id: string;                    // uuid — server tự sinh nếu request thiếu (FR-011)
  title: string;                 // required, max 255 ký tự
  assigneeUserId: string | null; // optional, uuid — KHÔNG bắt buộc là participant của meeting
  dueDate: string | null;        // optional, ISO date string (yyyy-mm-dd)
  priority: 'low' | 'medium' | 'high'; // optional, mặc định 'medium'
}
```
Nguồn: khớp field mẫu trong UC-132 (`API_CONTRACT_v1.0_with_system_roles.md` dòng 4297-4304), bổ sung `id` theo quyết định research.md mục 2 (#4).

**Không có** field `status`/hoàn thành cho từng action item trong phạm vi feature này (xem spec.md mục 8.1).

## 3. DTO dự kiến (định hướng cho Codex, không phải code thật)

### 3.1 `DecisionItemDto`
```ts
class DecisionItemDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  decision: string;

  @IsOptional() @IsUUID()
  responsibleUserId?: string | null;
}
```

### 3.2 `ActionItemDto`
```ts
class ActionItemDto {
  @IsOptional() @IsUUID()
  id?: string;

  @IsString() @IsNotEmpty() @MaxLength(255)
  title: string;

  @IsOptional() @IsUUID()
  assigneeUserId?: string | null;

  @IsOptional() @IsDateString()
  dueDate?: string | null;

  @IsOptional() @IsIn(['low', 'medium', 'high'])
  priority?: 'low' | 'medium' | 'high';
}
```

### 3.3 `UpdateDraftMinutesDto`
```ts
class UpdateDraftMinutesDto {
  @IsInt() @Min(1)
  versionNo: number;

  @IsOptional() @IsString() @MaxLength(255)
  title?: string;

  @IsOptional() @IsString() @MaxLength(20000)
  minutesContent?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DecisionItemDto)
  decisionsJson?: DecisionItemDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => ActionItemDto)
  actionItemsJson?: ActionItemDto[];
}
```
**Validate "ít nhất 1 field trong 4"**: KHÔNG dùng decorator (khó biểu diễn gọn) — kiểm tra thủ công trong `MinutesService.updateDraft` trước khi mở transaction (xem plan.md mục 7.1 bước 1).

### 3.4 Response (`UpdateDraftMinutesResponseDto`)
Xem spec.md mục 5.3 — field: `id, meetingId, title, status, versionNo, minutesContent, decisionsJson, actionItemsJson, attendeesSnapshotJson, preparedBy, updatedAt`.

## 4. State Diagram (không đổi trong feature này)
```text
draft --(update, nhiều lần, versionNo += 1 mỗi lần)--> draft
draft --(ngoài phạm vi: feat-issue-meeting-minutes)--> published
```

## 5. Không có migration schema
Chỉ có 1 migration seed permission `meeting.minutes.update` (xem plan.md mục 4.3) — không `ALTER TABLE` nào.
