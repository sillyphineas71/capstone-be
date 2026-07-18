# Research: Share Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo research cho feat-share-meeting-minutes | Toàn bộ file |

## 1. Xác nhận quy tắc xem biên bản hiện tại (đọc code thật, không chỉ spec)

Đọc trực tiếp `src/modules/minutes/services/minutes.service.ts`:
- Hàm `canAccessMinutes()` (dòng 910-929) là **choke-point duy nhất** cho quyết định "user X có xem được biên bản Y không".
- Được gọi từ `findMinutesDetail()` (dòng 931+, xem chi tiết biên bản) và `loadMinutesForReadCheck()` (dòng 510-562, dùng cho attachment list/detail — có comment nguồn "Dung chung logic voi findMinutesDetail (canAccessMinutes)").
- Logic thật: `isAdmin` (chỉ `SYSTEM_ADMIN`/`BUSINESS_ADMIN`, KHÔNG gồm `MANAGER`) → true; `draft` → chỉ `preparedBy`; `published`/`archived` → `isHost` (`meeting.hostId === userId`) OR `isParticipant` (có mặt trong `meeting_participants`).

Điều này xác nhận: mô tả ban đầu của Product Owner ("chỉ host và admin/manager mới xem được") **không hoàn toàn khớp code thật** — thực tế mọi participant của meeting đã xem được biên bản published từ trước, và Manager không tự động bypass. Đã báo cáo rõ sai khác này lại cho Product Owner trước khi thiết kế (xem hội thoại) để đảm bảo feature mới xây trên đúng baseline, không phải baseline tưởng tượng.

## 2. Vì sao không dùng `visibility_level` có sẵn?

`MeetingMinutesEntity.visibilityLevel` (enum `PRIVATE/PARTICIPANTS/DEPARTMENT/PUBLIC_INTERNAL`) đã được xác nhận qua NHIỀU spec trước (`feat-issue-meeting-minutes/research.md` mục 3, `feat-list-meeting-minutes`) là field **hoàn toàn không được đọc bởi bất kỳ logic phân quyền nào** — set giá trị gì cũng không ảnh hưởng hành vi thực tế. Field này biểu diễn NHÓM RỘNG (participant/department/toàn nội bộ), không có khả năng biểu diễn "share đích danh cho 3 cá nhân cụ thể X, Y, Z" — về bản chất khác hẳn kiểu dữ liệu cần (many-to-many user↔minutes), nên không thể tái sử dụng dù chỉ đổi cách đọc field. Bảng ACL mới là lựa chọn đúng, không phải "thêm bảng cho tiện" mà vì đúng model dữ liệu.

## 3. So sánh với các bảng ACL/grant khác trong baseline

| Bảng | Ý nghĩa | Xóa dùng cách nào? |
| :--- | :--- | :--- |
| `role_permissions` | Grant permission cho role | Hard-delete (`DELETE FROM role_permissions WHERE ...`, xác nhận qua `down()` của mọi migration seed permission đã đọc, ví dụ `20260702030000-SeedMeetingMinutesIssuePermission.ts`) |
| `meeting_participants` | Người tham gia cuộc họp | Hard-delete (UC-MM-08 `feat-remove-internal-meeting-participant`, không có `deleted_at`) |
| `meeting_minutes_shares` (mới) | Grant quyền xem biên bản cho user cụ thể | **Đề xuất hard-delete**, theo đúng 2 tiền lệ trên |

Cả 2 bảng tiền lệ đều là quan hệ "cấp quyền/thành viên" thuần túy (không phải nội dung nghiệp vụ), và đều hard-delete khi thu hồi. `meeting_minutes_shares` cùng bản chất — không phải deviation mới, mà là áp dụng lại đúng 1 pattern đã có sẵn trong chính baseline DB. Về mặt tuân thủ `DATA-01` (Layer 1, "chỉ hard-delete cho logs>90 ngày/temp files"), đây là điểm cần ghi nhận minh bạch: pattern hard-delete cho bảng ACL đã tồn tại từ trước feature này (ở `role_permissions`/`meeting_participants`), tức là RFC/quyết định kiến trúc đó đã được chấp nhận từ lâu ở cấp baseline — feature này chỉ nhất quán theo, không tự ý mở rộng deviation.

## 4. Route ordering — không xung đột

`MeetingMinutesListController` hiện có (theo báo cáo research trước, feature `feat-export-meeting-minutes`): `GET /`, `GET /search-by-person`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/issue`, `PATCH /:id/link-resources`, `POST /:minutesId/attachments`, `GET /:minutesId/attachments`, `DELETE /:minutesId/attachments/:fileId`, (dự kiến thêm) `POST /:id/exports`.

3 route mới (`POST /:id/shares`, `GET /:id/shares`, `DELETE /:id/shares/:userId`) không trùng path với bất kỳ route nào ở trên (segment cuối `/shares` là duy nhất). Không có rủi ro route-ordering kiểu `GET :id` vs `GET search-by-person` (khác HTTP method/path pattern rõ ràng).

## 5. Rủi ro kỹ thuật lớn nhất: chuyển `canAccessMinutes()` từ sync sang async

Đây là phát hiện quan trọng nhất của research này. Hàm hiện tại:
```ts
private canAccessMinutes(...): boolean { ... }
```
Để thêm truy vấn `meeting_minutes_shares`, hàm bắt buộc trở thành `async ...: Promise<boolean>`. Cả 2 nơi gọi hàm này hiện đang viết dạng:
```ts
if (!this.canAccessMinutes(minutes, meeting, userId, isAdmin, isParticipant)) {
  throw new ForbiddenException(...)
}
```
Nếu quên thêm `await`, biểu thức `!this.canAccessMinutes(...)` sẽ đánh giá `!Promise<boolean>` — **một Promise object luôn truthy trong JavaScript**, nên `!Promise` luôn là `false`, khiến điều kiện `if` không bao giờ đúng → **guard bị vô hiệu hóa hoàn toàn, mọi user đều xem được mọi biên bản** (bao gồm cả `draft` riêng tư). Đây là lỗ hổng bảo mật nghiêm trọng dạng "async/await bị bỏ sót", cần đặc biệt cẩn trọng khi implement — đã ghi rõ vào plan.md mục 12 (Risks) và mục 10.2 (bắt buộc có test regression cho nhánh KHÔNG được share).

## 6. Q&A đã chốt (research trước khi hỏi Product Owner qua AskUserQuestion)

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | Share được lúc nào? | Chỉ khi `status=published` — Product Owner xác nhận. |
| 2 | Share cho ai? | Bất kỳ user nội bộ active nào, không giới hạn phòng ban — Product Owner xác nhận. |
| 3 | Share có bị thu hồi tự động khi biên bản chuyển `archived` không? | Không — đề xuất mặc định, chưa bị phản đối. Lý do: tránh UX bất ngờ "đang xem được tự nhiên mất quyền" chỉ vì Admin archive biên bản; nhất quán triết lý `archived` vẫn mở quyền xem rộng hơn `draft` trong hàm hiện có. |
| 4 | Dùng bảng mới hay field có sẵn? | Bảng mới `meeting_minutes_shares` — `visibility_level` không phù hợp model dữ liệu (xem mục 2). |
| 5 | Duplicate grant / revoke-not-found xử lý sao? | Cả hai đều trả lỗi rõ ràng (`409`/`404`), không fake success — nhất quán triết lý đã áp dụng cho `AGENDA_DUPLICATE_ITEM_ID`/DELETE agenda item ở module `meetings` trong cùng phiên làm việc. |
| 6 | Permission naming? | `meeting.minutes.share.{create,read,delete}` — đúng granularity/convention đã dùng cho `meeting.minutes.attachment.*`. |

## 7. Kết luận
Không có unknown nào chặn việc viết plan.md/tasks.md. Rủi ro kỹ thuật lớn nhất (sync→async migration của `canAccessMinutes()`) đã được nhận diện rõ và có kế hoạch mitigation cụ thể (mục 5, plan.md mục 12). Không còn `[NEEDS CLARIFICATION]` nào mở trong spec.md.
