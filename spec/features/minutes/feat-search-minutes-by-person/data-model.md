# Data Model: Search Meeting Minutes by Person

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-search-minutes-by-person | Toàn bộ file |

## 1. Bảng liên quan (chỉ đọc, không bảng/cột mới)

### 1.1 `users` (đọc)
| Column | Feature này |
| :--- | :--- |
| `id`, `full_name`, `email` | Validate `userId` tồn tại + dựng `meta.person` |
| `deleted_at` | Điều kiện `IS NULL` khi validate |
| `department_id` | Đọc gián tiếp qua `meetings.host_id`/`organizer_id` (không phải đọc trực tiếp từ target user) |

### 1.2 `departments` (đọc, chỉ khi actor là Manager)
| Column | Feature này |
| :--- | :--- |
| `id` | Kết quả `managedDepartmentIds` |
| `manager_user_id` | Điều kiện `= authUser.userId` |
| `is_active`, `deleted_at` | Điều kiện lọc phòng ban còn hiệu lực |

### 1.3 `meeting_minutes` (đọc, bảng chính)
| Column | Feature này |
| :--- | :--- |
| `id`, `title`, `status`, `version_no`, `created_at` | Trả trong `data[]` |
| `prepared_by` | Điều kiện "nhân sự liên quan" (nhánh 1) |
| `meeting_id` | JOIN `meetings` |
| `deleted_at` | Điều kiện `IS NULL` (loại trừ deleted) |

### 1.4 `meetings` (đọc, JOIN)
| Column | Feature này |
| :--- | :--- |
| `id`, `title`, `actual_start_time`, `actual_end_time`, `meeting_mode`, `room_id` | Trả trong `data[].meeting` |
| `host_id` | JOIN `users` (host) để lấy `departmentId` — điều kiện scope Manager |
| `organizer_id` | JOIN `users` (organizer, MỚI so với `findMinutesList`) — fallback điều kiện scope Manager khi `host_id IS NULL` |

### 1.5 `meeting_participants` (đọc, EXISTS subquery)
Điều kiện "nhân sự liên quan" (nhánh 2): `EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :targetUserId)`.

### 1.6 `rooms` (đọc, LEFT JOIN)
Room summary, giống hệt `findMinutesList`.

## 2. Query Parameters (đầu vào)
| Parameter | Type | Bắt buộc | Validation |
| :--- | ---: | ---: | :--- |
| `userId` | uuid | Có | `@IsUUID('4')` |
| `page` | integer | Không (mặc định 1) | `>= 1` |
| `limit` | integer | Không (mặc định 20) | `1 <= limit <= 20` |

## 3. DTO dự kiến

### 3.1 `SearchMinutesByPersonQueryDto`
```ts
class SearchMinutesByPersonQueryDto {
  @IsUUID('4')
  userId: string;

  @IsOptional() @Type(() => Number) @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @Min(1) @Max(20)
  limit?: number = 20;
}
```

### 3.2 `PersonSummaryDto` (mới, dùng cho `meta.person`)
```ts
class PersonSummaryDto {
  id: string;
  fullName: string;
  email: string;
}
```

### 3.3 Response item (`data[]`)
Tái dùng nguyên `MinutesListItemDto`/`MinutesMeetingSummaryDto`/`RoomSummaryDto`/`UserSummaryDto` đã có ở `feat-list-meeting-minutes` — KHÔNG tạo DTO mới cho phần này.

## 4. Logic tính `managedDepartmentIds` (chỉ khi actor là Manager)
```sql
SELECT id FROM departments
WHERE manager_user_id = :managerId
  AND deleted_at IS NULL
  AND is_active = true
```
Nếu kết quả rỗng → trả `{ items: [], total: 0 }` ngay, không cần query `meeting_minutes` (tối ưu, tránh query thừa).

## 5. Điều kiện scope theo role (tóm tắt)

| Actor | `status` cho phép | Điều kiện phòng ban |
| :--- | :--- | :--- |
| `MANAGER` | `published`, `archived` | `host.departmentId IN managedDepartmentIds` OR (`meeting.hostId IS NULL` AND `organizer.departmentId IN managedDepartmentIds`) |
| `BUSINESS_ADMIN` / `SYSTEM_ADMIN` | `draft`, `published`, `archived` | Không giới hạn |

Cả 2 nhánh đều: `minutes.deletedAt IS NULL` + (`minutes.preparedBy = targetUserId` OR tồn tại `meeting_participants` với `targetUserId`).

## 6. Không có migration schema
Chỉ có 1 migration seed permission `meeting.minutes.search_by_person` (xem plan.md mục 4.3) — không `ALTER TABLE` nào.
