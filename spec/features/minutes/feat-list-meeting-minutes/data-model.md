# Data Model: List Meeting Minutes (UC-MKM-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-list-meeting-minutes | Toàn bộ file |

## 1. ER liên quan (chỉ phần dùng trong feature này)

```text
meeting_minutes (N) >── (1) meetings (1) ──< meeting_participants (N)
        │                      │
        │ prepared_by          │ host_id / room_id
        ▼                      ▼
      users                  rooms / users
```

## 2. Bảng bị đọc (không ghi)

### 2.1 `meeting_minutes`
| Cột dùng | Mục đích |
| :--- | :--- |
| `id` | Response field |
| `meeting_id` | Join sang `meetings` |
| `title` | Response field |
| `version_no` | Response field |
| `status` | Filter + scope (draft/published/archived, loại trừ deleted) |
| `visibility_level` | Đọc để dự phòng tương lai, KHÔNG dùng làm điều kiện scope chính trong feature này (xem research.md 1.3) |
| `prepared_by` | Scope: xác định "Host tạo bản Nháp" |
| `created_at` | Response field + sort option |
| `deleted_at` | Luôn lọc `IS NULL` (tương đương loại trừ status=deleted) |

### 2.2 `meetings`
| Cột dùng | Mục đích |
| :--- | :--- |
| `id` | Join key |
| `title` | Response field (meeting.title) |
| `host_id` | Scope (host thấy published/archived) + response field (host summary) |
| `room_id` | Filter `roomId` + join `rooms` |
| `actual_start_time` | Filter `from/to` + sort mặc định + response field |
| `actual_end_time` | Response field |
| `meeting_mode` | Response field (xác định online/offline/hybrid để FE hiển thị khi room=null) |

### 2.3 `meeting_participants`
| Cột dùng | Mục đích |
| :--- | :--- |
| `meeting_id`, `user_id` | Scope: EXISTS check currentUser có phải participant của meeting không |

### 2.4 `rooms`
| Cột dùng | Mục đích |
| :--- | :--- |
| `id`, `room_name` | Response field room summary (null nếu `meetings.room_id` null) |

### 2.5 `users`
| Cột dùng | Mục đích |
| :--- | :--- |
| `id`, `full_name`, `email` | Response field host summary (join qua `meetings.host_id`) |

## 3. Không có bảng/cột nào được INSERT/UPDATE

Feature này chỉ đọc dữ liệu (`SELECT`), không insert/update/delete bất kỳ bảng nào.

## 4. Seed / Migration

- **Không có migration thay đổi schema** (không thêm bảng/cột).
- **Migration mới cho permission**: `meeting.minutes.read` (module_code=`minutes`, action_code=`minutes.read`), gán cho roles `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. Đặt tại `src/database/migrations/` (không đặt tại `src/database/seeds/`, xem research.md mục 1.6).

## 5. Query Scope Model (logic chính của feature)

```text
isAdmin = currentUser có role SYSTEM_ADMIN hoặc BUSINESS_ADMIN

WHERE minutes.deleted_at IS NULL
  AND (
    isAdmin = true
    OR (
      (minutes.status = 'draft' AND minutes.prepared_by = currentUser.id)
      OR (
        minutes.status IN ('published', 'archived')
        AND (
          meeting.host_id = currentUser.id
          OR EXISTS (
            SELECT 1 FROM meeting_participants mp
            WHERE mp.meeting_id = meeting.id AND mp.user_id = currentUser.id
          )
        )
      )
    )
  )
  AND [status filter nếu client truyền — AND thêm, không thay thế scope trên]
  AND [roomId / from-to / q filter nếu có]
```

## 6. Data Constraints

- `meeting_minutes.status` chỉ nhận các giá trị hợp lệ theo enum `MeetingMinutesStatus` (`draft`, `published`, `archived`, `deleted`) — query luôn loại `deleted`.
- `meetings.room_id` có thể null — response phải trả `room = null`.
- `meetings.host_id` có thể null (theo entity, dù nghiệp vụ tạo draft yêu cầu host phải có — vẫn xử lý null-safe ở tầng response).

## 7. Data Lifecycle

Không thay đổi. Feature chỉ đọc dữ liệu được tạo bởi `feat-create-draft-meeting-minutes` và các feature publish/archive/delete trong tương lai.

## 8. Data-related EARS Requirements

Tham chiếu spec.md mục 3.5, 3.6 (FR-020 → FR-030) và mục 5.
