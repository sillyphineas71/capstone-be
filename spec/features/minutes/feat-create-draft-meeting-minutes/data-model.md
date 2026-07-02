# Data Model: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-create-draft-meeting-minutes | Toàn bộ file |

## 1. ER liên quan (chỉ phần dùng trong feature này)

```text
meetings (1) ──< meeting_participants (N)
   │
   │ (1)
   ▼
meeting_minutes (0..1 active per meeting)
```

## 2. Bảng bị đọc (không ghi)

### 2.1 `meetings`
| Cột dùng | Mục đích |
| :--- | :--- |
| `id` | Xác định meeting |
| `host_id` | Kiểm tra quyền Host |
| `title` | Sinh title mặc định cho biên bản |
| `status` | Guard trạng thái (`in_progress`/`completed` mới cho tạo) |
| `actual_start_time`, `actual_end_time` | Trả về response (BR2 — chỉ đọc, không cho sửa) |
| `room_id` | Trả về response (thông tin phòng họp) |

### 2.2 `meeting_participants`
| Cột dùng | Mục đích |
| :--- | :--- |
| `user_id`, `participant_role` | Snapshot danh sách tham dự |
| `attendance_status`, `joined_at`, `left_at` | Snapshot trạng thái điểm danh (BR2 — khóa cứng) |

## 3. Bảng được INSERT (tạo mới)

### 3.1 `meeting_minutes` — 1 dòng mới
| Cột | Giá trị khi tạo | Ghi chú |
| :--- | :--- | :--- |
| `id` | `gen_random_uuid()` | |
| `meeting_id` | `:meetingId` từ path param | |
| `title` | `dto.title` hoặc `"Biên bản họp: {meeting.title}"` | FR-010/011 |
| `version_no` | `1` | Default entity |
| `status` | `'draft'` | FR-002 |
| `visibility_level` | `'private'` | FR-003 — ghi đè default entity (`participants`) |
| `minutes_content` | Khung nội dung mặc định (không rỗng) | FR-017 |
| `attendees_snapshot_json` | Mảng JSON từ `meeting_participants` tại thời điểm tạo | FR-006 |
| `decisions_json`, `action_items_json` | `NULL` | Ngoài phạm vi, để feature update điền sau |
| `linked_transcript_id`, `linked_recording_file_id`, `file_id` | `NULL` | Ngoài phạm vi |
| `issued_by`, `issued_at`, `approved_by`, `approved_at` | `NULL` | Chỉ set khi publish (feature khác) |
| `prepared_by` | `authUser.userId` (Host) | FR-004 |
| `created_at`, `updated_at` | `now()` | Auto |
| `deleted_at` | `NULL` | |

### 3.2 `audit_logs` — 1 dòng mới
| Cột | Giá trị |
| :--- | :--- |
| `user_id` | Host thực hiện |
| `action_type` | `'meeting_minutes_draft_created'` |
| `entity_type` | `'meeting_minutes'` |
| `entity_id` | id vừa tạo |
| `metadata_json` | `{ meetingId, meetingStatus }` |

## 4. Seed / Migration
- **Không có migration DB mới** (bảng đã có sẵn trong baseline, xem research.md mục 1.1).
- **Seed permission mới**: `meeting.minutes.create` (module_code=`minutes`, action_code=`minutes.create`), gán cho roles `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 5. State / Status Model
`meeting_minutes.status` lifecycle đầy đủ: `draft → published → archived`, và `deleted` (soft-delete). Feature này chỉ sinh trạng thái `draft`.

## 6. Data Constraints
- Nghiệp vụ: tối đa 1 bản ghi active (`deleted_at IS NULL`) per `meeting_id` — kiểm tra ở service layer trong transaction (không có DB constraint, xem research.md mục 1.5 cho lý do).
- `title`: string, tối đa 255 ký tự (khớp column `varchar(255)`).

## 7. Data Lifecycle
Tạo (feature này, DRAFT) → sửa nội dung/autosave (tương lai) → publish (tương lai, chuyển `published`, set `issued_by`/`issued_at`) → archive/soft-delete (tương lai).

## 8. Data-related EARS Requirements
Tham chiếu spec.md mục 3.7 (FR-016, FR-017) và 5.5.
