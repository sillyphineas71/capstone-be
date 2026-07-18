# Quickstart: Share Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo quickstart cho feat-share-meeting-minutes | Toàn bộ file |

- **Grant**: `POST /api/v1/meeting-minutes/{id}/shares`
- **List**: `GET /api/v1/meeting-minutes/{id}/shares`
- **Revoke**: `DELETE /api/v1/meeting-minutes/{id}/shares/{userId}`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Preparer share cho 1 user | Biên bản `published`, `preparedBy=U`. `U` POST shares `{userId: X}` (X active, chưa share) | 201, dòng `meeting_minutes_shares` mới, audit log |
| 2 | User được share xem được biên bản | Sau #1, `X` GET `/meeting-minutes/{id}` | 200 (dù X không phải participant/host) |
| 3 | Host xem danh sách share | `U` GET `.../shares` | 200, danh sách chứa `X` |
| 4 | Host revoke | `U` DELETE `.../shares/X` | 200, dòng share bị xóa, audit log |
| 5 | Sau revoke, X không còn xem được | Sau #4, `X` GET `/meeting-minutes/{id}` | 403 MEETING_MINUTES_ACCESS_DENIED |
| 6 | Business Admin share hộ | Admin `C` POST shares cho biên bản của người khác | 201 |
| 7 | Share vẫn hiệu lực sau khi archived | Share cho X lúc `published`, sau đó biên bản chuyển `archived`, X GET detail | 200 (không tự mất quyền) |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 8 | Participant thường gọi share | POST/GET/DELETE shares bởi user không phải preparedBy/host/Admin | 403 NOT_MINUTES_OWNER |
| 9 | Thiếu permission | POST shares bởi user không có `meeting.minutes.share.create` | 403 FORBIDDEN |

### Business Rule Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 10 | Biên bản còn draft | POST shares cho biên bản `status=draft` | 409 MINUTES_NOT_PUBLISHED |
| 11 | Biên bản đã archived, share MỚI | POST shares cho biên bản `status=archived` | 409 MINUTES_NOT_PUBLISHED |
| 12 | Target user không active | POST shares với `userId` của user `inactive` | 422 USER_INACTIVE |
| 13 | Target user không tồn tại | POST shares với `userId` ngẫu nhiên | 404 USER_NOT_FOUND |
| 14 | Grant trùng | POST shares 2 lần liên tiếp cùng `userId` | Lần 1: 201, lần 2: 409 ALREADY_SHARED |
| 15 | Revoke không tồn tại | DELETE shares/{userId} cho user chưa từng share | 404 SHARE_NOT_FOUND |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 16 | `id` không phải UUID | Gọi bất kỳ endpoint nào với path param sai | 400 |
| 17 | Thiếu `userId` trong body | POST shares body `{}` | 400 VALIDATION_ERROR |

### Not Found Cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 18 | Biên bản không tồn tại | Gọi bất kỳ endpoint nào với `id` ngẫu nhiên hợp lệ UUID | 404 MINUTES_NOT_FOUND |

### Regression Cases (bắt buộc — do sửa hàm dùng chung `canAccessMinutes`)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 19 | User KHÔNG được share vẫn bị chặn | User bất kỳ không phải participant/host/Admin/được share, GET detail biên bản published | 403 (như hành vi cũ, KHÔNG được vô tình mở toang do lỗi async/await) |
| 20 | Draft vẫn tuyệt đối riêng tư | User được share (qua feature mới) thử xem biên bản CÙNG preparedBy nhưng đang `draft` (biên bản khác, chưa share) | 403 — nhánh draft không bị ảnh hưởng bởi thay đổi này |
| 21 | Attachment list vẫn hoạt động đúng | User được share gọi `GET .../attachments` | 200 — tự động hưởng lợi qua `loadMinutesForReadCheck` dùng chung `canAccessMinutes()` |

## Verification Notes

- [ ] `meeting_minutes_shares` có đúng `UNIQUE (minutes_id, user_id)` — thử insert trùng qua raw SQL, xác nhận DB tự chặn.
- [ ] `canAccessMinutes()` đã chuyển `async`, cả 2 call-site (`findMinutesDetail`, `loadMinutesForReadCheck`) đều có `await` — **verify bằng cách chạy test #19 trước tiên**, đây là test quan trọng nhất của toàn bộ feature.
- [ ] Audit log có 2 action type riêng biệt (`meeting_minutes_shared`/`meeting_minutes_unshared`), không lẫn với `meeting_minutes_issued`.
- [ ] Danh sách share (`GET .../shares`) trả đúng `userFullName`/`userEmail`/`grantedByName` (không phải chỉ UUID thô).
- [ ] Regression: `feat-issue-meeting-minutes`, `feat-view-meeting-minutes-detail`, `feat-attach-minutes-document`, `feat-export-meeting-minutes` (nếu đã implement) vẫn hoạt động bình thường sau khi sửa `canAccessMinutes()` + thêm route mới.
