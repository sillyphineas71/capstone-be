# Quickstart: Search Meeting Minutes by Person (UC-MKM-07)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-search-minutes-by-person | Toàn bộ file |

## 1. Chuẩn bị dữ liệu test

1. Có 1 phòng ban `D1` với `manager_user_id = M` (Manager), 1 phòng ban `D2` với `manager_user_id` khác (hoặc null).
2. Có 2 user thuộc `D1`: Host `H1` (`department_id = D1`), nhân sự cần tra cứu `U` (bất kỳ phòng ban nào — không quan trọng, vì scope tính theo phòng ban của **cuộc họp**, không phải của `U`).
3. Có 1 `meeting` A với `host_id = H1` (thuộc `D1`), `U` là `meeting_participants` của A. Tạo `meeting_minutes` cho A, set `status='published'` (SQL trực tiếp, vì chưa có feature publish).
4. Có 1 `meeting` B với `host_id` thuộc `D2` (KHÁC `D1`), `U` cũng là participant của B. Tạo `meeting_minutes` cho B, set `status='published'`.
5. Có 1 `meeting` C với `host_id = H1` (thuộc `D1`), `U` là `prepared_by` của biên bản C nhưng KHÔNG phải participant. Set `status='published'`.
6. Có 1 `meeting` D với `host_id = H1` (thuộc `D1`), `U` là `prepared_by`, giữ `status='draft'` (không set lại).
7. Login lấy JWT của Manager `M`, Business Admin `BA`, và 1 Internal Employee thường `E`.

## 2. Chạy migration seed permission

```bash
npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```
Migration `SeedMeetingMinutesSearchByPersonPermission...` thêm permission `meeting.minutes.search_by_person`, gán cho `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (**không** gán `INTERNAL_USER`).

## 3. Test kịch bản Happy Path

### 3.1 Manager thấy biên bản đúng phòng ban (AC-001, AC-004)
```bash
curl -X GET "http://localhost:3000/api/v1/meeting-minutes/search-by-person?userId=<U>" \
  -H "Authorization: Bearer <mJwt>"
```
Kỳ vọng: `200`, `data` chứa biên bản của meeting A (participant) và meeting C (prepared_by), KHÔNG chứa meeting B (khác phòng ban), KHÔNG chứa meeting D (draft). `meta.person.id = U`.

### 3.2 Business Admin thấy cả draft (AC-003)
```bash
curl -X GET "http://localhost:3000/api/v1/meeting-minutes/search-by-person?userId=<U>" \
  -H "Authorization: Bearer <baJwt>"
```
Kỳ vọng: `200`, `data` chứa CẢ 4 biên bản (A, B, C, D) — không giới hạn phòng ban, không giới hạn status.

## 4. Test kịch bản lỗi/rỗng

| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Internal Employee gọi API | `E` (role `INTERNAL_USER`) gọi | `403 FORBIDDEN` (không có permission) |
| `userId` không tồn tại | UUID ngẫu nhiên hợp lệ | `404 USER_NOT_FOUND` |
| `userId` đã xóa mềm | Soft-delete 1 user rồi tra cứu | `404 USER_NOT_FOUND` |
| `userId` không phải UUID | `?userId=abc` | `400 VALIDATION_ERROR` |
| `limit` vượt quá | `?userId=<U>&limit=50` | `400 VALIDATION_ERROR` |
| Manager không phụ trách phòng ban nào | Tạo 1 Manager khác (`M2`) không có dòng `departments.manager_user_id` nào trỏ tới | `200`, `data=[]` |
| Nhân sự tồn tại nhưng chưa từng liên quan tới biên bản nào trong phạm vi | Tạo user mới `U2` chưa từng là participant/preparedBy của cuộc họp nào | `200`, `data=[]`, `meta.total=0` (đúng EX2 của UC gốc) |

## 5. Verification checklist sau khi implement

- [ ] Manager chỉ thấy biên bản `published`/`archived` mà cuộc họp thuộc đúng phòng ban mình phụ trách (qua `host`, fallback `organizer` nếu host null).
- [ ] Manager KHÔNG thấy biên bản `draft` của nhân sự, kể cả khi đúng phòng ban.
- [ ] Business Admin/System Admin thấy toàn bộ (mọi status trừ deleted), không giới hạn phòng ban.
- [ ] `INTERNAL_USER` luôn nhận `403 FORBIDDEN` (không có permission).
- [ ] "Nhân sự liên quan" tính đúng cả 2 nhánh: participant VÀ prepared_by (test riêng từng nhánh).
- [ ] `userId` không tồn tại/đã xóa → `404`, không phải `200` rỗng.
- [ ] Manager không phụ trách phòng ban nào → `200` rỗng, không phải lỗi.
- [ ] `meta.person` luôn khớp đúng thông tin nhân sự đang tra cứu.
- [ ] Không có `audit_logs` nào được tạo khi tra cứu.
- [ ] Response KHÔNG chứa `minutesContent`/`decisionsJson`/`actionItemsJson`/`attendeesSnapshotJson`.
