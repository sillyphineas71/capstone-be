# Plan — BE-02 GET /api/v1/meetings

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo plan lần đầu | Toàn bộ file |

---

## 1. File đích

### Code mới
| File | Nội dung |
| :-- | :-- |
| `src/modules/meetings/dto/meeting-list-query.dto.ts` | Query params + allowlist `sortBy` |
| `src/modules/meetings/dto/meeting-list-item.dto.ts` | Field trả về (không lộ dữ liệu nhạy cảm) |
| `src/modules/meetings/services/meeting-list.service.ts` | QueryBuilder + parameter binding, service riêng |
| `src/modules/meetings/services/meeting-list.service.spec.ts` | Unit test |

### Code sửa
| File | Việc |
| :-- | :-- |
| `src/modules/meetings/controllers/meetings.controller.ts` | Thêm `@Get('meetings')` **trước** `@Get('meetings/:meetingId')`; `@RequirePermissions('meeting.read.all')` |
| `src/modules/meetings/meetings.module.ts` | Đăng ký `MeetingListService` |
| `src/modules/meetings/tests/update-agenda-item.controller.spec.ts` | Thêm mock provider `MeetingListService` (constructor MeetingsController có thêm tham số) |
| `src/modules/meetings/tests/delete-agenda-item.controller.spec.ts` | Thêm mock provider `MeetingListService` (như trên) |

### Migration (bắt buộc)
| File | Việc |
| :-- | :-- |
| `src/database/migrations/20260726000003-SeedMeetingReadAllPermission.ts` | Seed `meeting.read.all` → `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. Idempotent (`WHERE NOT EXISTS`), có `down()`. |

## 2. Thứ tự thực hiện

1. Re-check `ls src/database/migrations | sort | tail` ngay trước khi đặt tên file migration (bài học Bước 3 — số migration có thể bị người khác chiếm giữa phiên).
2. DTO (`meeting-list-query.dto.ts`, `meeting-list-item.dto.ts`).
3. `meeting-list.service.ts` + spec.
4. Controller (`GET meetings`) + module đăng ký service.
5. Chạy full suite `src/modules/meetings` để bắt regression (constructor `MeetingsController` đổi signature ảnh hưởng mọi test dựng `TestingModule` thủ công) — đã phát hiện + sửa 2 file test (`update-agenda-item`, `delete-agenda-item`) thiếu mock provider mới.
6. Migration.

## 3. Cách test

- `meeting-list.service.spec.ts`: mock `DataSource.getRepository().createQueryBuilder()`, kiểm tra từng `andWhere` theo filter, allowlist `sortBy` map đúng cột, `skip/take` đúng công thức phân trang, chặn `from > to` (400), map DTO từ `getRawAndEntities()` (entity + raw join fields).
- Không có route-level e2e mới cho đợt P0 này (theo phạm vi đã chốt).
