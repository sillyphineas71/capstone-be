# Plan — BE-03 PATCH /api/v1/meetings/{meetingId}

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo plan lần đầu | Toàn bộ file |

---

## 1. File đích

### Code mới
| File | Nội dung |
| :-- | :-- |
| `src/modules/meetings/dto/update-meeting.dto.ts` | `title?`, `description?` (validate độ dài, không có validation "chặn body rỗng" ở tầng DTO — xử lý ở service vì cả 2 field optional nên DTO tự nó không đủ để phân biệt "không gửi" khác gì) |
| `src/modules/meetings/dto/update-meeting-response.dto.ts` | `{meetingId, title, description, updatedAt}` |
| `src/modules/meetings/services/meeting-update.service.ts` | Ownership check (organizer/host), chặn cancelled/completed, transaction + `meeting_events` |
| `src/modules/meetings/services/meeting-update.service.spec.ts` | Unit test (10 test case) |

### Code sửa
| File | Việc |
| :-- | :-- |
| `src/modules/meetings/entities/meeting-event.entity.ts` | Thêm `MeetingEventType.METADATA_UPDATED = 'metadata_updated'` |
| `src/modules/meetings/controllers/meetings.controller.ts` | Thêm `@Patch('meetings/:meetingId')`, permission `meeting.update.own`, khai gần `@Get('meetings/:meetingId')` |
| `src/modules/meetings/meetings.module.ts` | Đăng ký `MeetingUpdateService` |
| `src/modules/meetings/tests/update-agenda-item.controller.spec.ts` | Thêm mock provider `MeetingUpdateService` (constructor đổi lần nữa) |
| `src/modules/meetings/tests/delete-agenda-item.controller.spec.ts` | Thêm mock provider `MeetingUpdateService` (như trên) |

### Migration (bắt buộc)
| File | Việc |
| :-- | :-- |
| `src/database/migrations/20260726000004-SeedMeetingUpdateOwnPermission.ts` | Seed `meeting.update.own` — role mapping **giống hệt** `meeting.cancel.own` (`EMPLOYEE`, `MANAGER`, `SYSTEM_ADMIN` — đã đối chiếu `20260720000005-BackfillRolePermissions.ts`, KHÔNG có `BUSINESS_ADMIN`). |

## 2. Thứ tự thực hiện

1. Re-check `ls src/database/migrations | sort | tail` ngay trước khi tạo migration.
2. Thêm enum `METADATA_UPDATED` vào `meeting-event.entity.ts`.
3. DTO (`update-meeting.dto.ts`, `update-meeting-response.dto.ts`).
4. `meeting-update.service.ts` + spec.
5. Controller + module.
6. Chạy `npx jest src/modules/meetings` — kiểm tra 2 file test dựng `TestingModule` thủ công (đã vỡ ở BE-02 vì thêm `MeetingListService`) cần thêm mock `MeetingUpdateService` nữa.
7. Migration.

## 3. Cách test

- `meeting-update.service.spec.ts`: chỉ gửi title (description giữ nguyên), chỉ gửi description (title giữ nguyên), ghi đúng `meeting_events` với `event_type = metadata_updated`, host cũng có quyền, body rỗng → 400 (không gọi `findOne` — fail sớm trước khi chạm DB), meeting không tồn tại/đã xóa mềm → 404, không phải organizer/host → 403, meeting cancelled/completed → 409.
