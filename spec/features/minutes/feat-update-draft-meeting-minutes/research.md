# Research: Update Draft Meeting Minutes (UC-MKM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research, ghi lại toàn bộ quyết định đã chốt qua Q&A trực tiếp với Product Owner trước khi lên spec | Toàn bộ file |

## 1. Nguồn UC gốc và điểm khác biệt giữa 2 tài liệu

Có **2 phiên bản** mô tả UC-MKM-04 được đối chiếu:
1. UC-MKM-04 "Cập nhật nội dung biên bản họp" — Feature Table gốc, do người dùng dán trực tiếp vào hội thoại (không có Business Rules chi tiết về concurrency/schema, `Exceptions: N/A`, `Other Information: N/A`).
2. UC-132 "Cập nhật nội dung biên bản họp" trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (dòng 4377-4399) — có sẵn method/endpoint/request body mẫu.

Hai nguồn khớp nhau về nghiệp vụ cốt lõi (PATCH nội dung biên bản đang draft, 409 khi đã published) nhưng UC-132 có endpoint `/api/v1/minutes/{minutesId}` — **khác** với convention `meeting-minutes` mà code hiện tại (`MeetingMinutesListController`) và 3 spec `minutes` trước đó đã dùng. Quyết định: đi theo code/spec đã có (`meeting-minutes`), không theo literal path của UC-132, để tránh tạo 2 prefix route song song cho cùng 1 resource trong module `minutes`. Ghi rõ deviation này trong spec.md mục 1.4 để không bị hiểu nhầm là bỏ sót yêu cầu.

## 2. Q&A đã chốt với Product Owner (thứ tự hỏi thực tế)

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | Ai được sửa: chỉ Host, hay cả Business Admin/System Admin? | **Chỉ Host.** Admin không được bypass, dù có permission gọi API (khác `feat-view-meeting-minutes-detail` UC-MKM-03 vốn cho `isAdmin` bypass — xem mục 3 "Mâu thuẫn cần theo dõi"). |
| 2 | "Host" nghĩa là gì: `meeting_minutes.prepared_by` hay `meetings.host_id`? | **Cả hai (OR).** Ban đầu đề xuất chỉ `prepared_by`, nhưng Product Owner yêu cầu chấp nhận cả 2 để không khóa quyền sửa khi Host của cuộc họp bị đổi sau khi người khác đã tạo biên bản. |
| 3 | Có xử lý đính kèm tài liệu trong UC-MKM-04 không? | **Không.** Đã có API riêng (`feat-attach-minutes-document`, 3 endpoint upload/list/delete). Description của UC gốc nhắc "đính kèm" nhưng đó là điểm mơ hồ cần loại bỏ khỏi scope. |
| 4 | Schema `action_items_json` chưa định nghĩa | Dùng đúng field mẫu đã có sẵn trong UC-132 (`title`, `assigneeUserId`, `dueDate`, `priority`), bổ sung `id` tự sinh để tham chiếu về sau. |
| 5 | Autosave 5 giây có thuộc UC-MKM-04 không? | **Không.** Chỉ save thủ công qua PATCH khi FE gọi (đúng Normal Flow của UC gốc — nút "Lưu thay đổi"). |
| 6 | Chống ghi đè đồng thời (concurrency)? | Optimistic locking qua `versionNo` đã có sẵn trong entity — client gửi kèm `versionNo` đang sửa, server so khớp trong transaction có lock. |
| 7 | `Exceptions: N/A` trong UC gốc — có chấp nhận được không? | Không — bổ sung đầy đủ theo gap analysis (biên bản không tồn tại, không phải chủ sở hữu, không phải draft, version lệch, input không hợp lệ). |
| 8 | Có ghi audit log không? | Có — `action_type=meeting_minutes_updated`, dùng `AuditLogsService.logEntityChange`. |
| 9 | PATCH (partial) hay yêu cầu gửi full nội dung? | **PATCH partial** — chỉ field được gửi mới bị ghi đè; bắt buộc có ít nhất 1 trong 4 field. |
| 10 | Có refresh `attendees_snapshot_json` khi meeting hoàn tất không? | Có, nhưng chỉ khi `meeting.status = completed` tại thời điểm update (không refresh liên tục khi còn `in_progress`). |

## 3. Mâu thuẫn cần theo dõi (không sửa trong phạm vi feature này)

`feat-view-meeting-minutes-detail/spec.md` (UC-MKM-03, FR-017) đã định nghĩa sẵn:
```text
permissions.canEdit = (status === draft) AND (isAdmin OR preparedBy === userId)
```
Quyết định #1/#2 ở trên (chỉ preparedBy HOẶC meeting.hostId, KHÔNG có admin, CÓ thêm nhánh host) làm công thức trên **sai lệch** so với rule thật sự của feature update. Vì UC-MKM-03 chưa có controller implement trong code (chỉ có spec), rủi ro thực tế còn thấp, nhưng khi ai đó implement UC-MKM-03 sau feature này, cần cập nhật lại công thức thành:
```text
permissions.canEdit = (status === draft) AND (preparedBy === userId OR meeting.hostId === userId)
```
Việc sửa `feat-view-meeting-minutes-detail/spec.md` nằm **ngoài phạm vi** worktree hiện tại (chỉ được sửa `feat-update-draft-meeting-minutes/`) — đã ghi chú lại trong spec.md mục 1.5 và mục 8.1/8.2 để không bị quên.

## 4. Có cần bảng/cột mới không?
**Không.** Toàn bộ cột cần dùng (`title`, `minutes_content`, `decisions_json`, `action_items_json`, `attendees_snapshot_json`, `version_no`, `prepared_by`, `status`) đã có sẵn trong `meeting_minutes` (baseline DB v3.2 Compact, xem `database_v3_2_compact_39_tables.md` dòng 1117-1154) và khớp 1-1 với `MeetingMinutesEntity` đã implement trong code (`src/modules/minutes/entities/meeting-minutes.entity.ts`).

## 5. Module `minutes` hiện có gì (đọc trực tiếp code, không suy đoán)
- `MinutesModule`: import các entity liên quan qua `MeetingsModule`/`RecordingModule`/`TranscriptionModule`/`AuthModule`/`AdministrationModule` (theo cách `createDraft`/`addAttachment` đã dùng).
- `MinutesController` (`@Controller()`, route `POST meetings/:meetingId/minutes`): tạo draft — KHÔNG đổi trong feature này.
- `MeetingMinutesListController` (`@Controller('meeting-minutes')`, route `GET`): danh sách — feature này thêm route `PATCH :id` vào cùng controller hoặc controller mới cùng prefix.
- `MinutesService`: đã có `createDraft`, `findMinutesList`, `addAttachment`, `listAttachments`, `removeAttachment`, `loadMinutesForOwnerCheck` (helper ownership hẹp — chỉ check `preparedBy`, KHÔNG đủ cho feature này vì cần thêm nhánh `meeting.hostId`).
- **Quan sát kỹ thuật quan trọng**: đọc trực tiếp `minutes.service.ts`, method `findMinutesList` kết thúc bằng khối `catch` nhưng dường như thiếu dấu `}` đóng method trước khi khối comment `/* Attachments (US1/US2/US3) */` bắt đầu (dòng ~416-428 lúc đọc). Đây có thể là lỗi hiển thị của công cụ đọc file hoặc lỗi thật trong code — Codex ở worktree implementation PHẢI tự đọc lại file thật và xác nhận trước khi chèn method `updateDraft` mới, để tránh chèn nhầm vào giữa 2 method hiện có.

## 6. Pattern permission/guard/audit đang dùng
- `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('<code>')`, decorator `@CurrentUser()` — xác nhận qua `minutes.controller.ts` và `minutes-list.controller.ts`.
- Permission code hiện tại luôn dùng tiền tố `meeting.minutes.*` (`meeting.minutes.create`, `meeting.minutes.read`, `meeting.minutes.attachment.*`) — **khác** với bảng permission liệt kê trong API_CONTRACT (`minutes.create`, `minutes.read`, `minutes.update` — không có tiền tố `meeting.`). Quyết định: đi theo code đã implement (`meeting.minutes.update`) để nhất quán, không tạo permission trùng ý nghĩa với 2 tên khác nhau.
- Seed permission luôn dùng **migration** (`src/database/migrations/`), KHÔNG dùng `src/database/seeds/` — đã xác nhận 2 lần bởi `feat-list-meeting-minutes/research.md` và `feat-attach-minutes-document/plan.md` (seed-runner cho thư mục `seeds/` chưa được wire vào đâu).
- `AuditLogsService` có 2 method phù hợp: `logAction` (chỉ metadata, dùng ở `createDraft`) và `logEntityChange` (có `oldValueJson`/`newValueJson`, phù hợp hơn cho feature update có before/after). Feature này dùng `logEntityChange`.

## 7. Rủi ro & quyết định thiết kế
| Rủi ro | Quyết định |
| :--- | :--- |
| Ownership rule 2 nhánh OR dễ viết sai (rò rỉ quyền hoặc chặn nhầm người hợp lệ) | Viết thành 1 boolean rõ ràng `isOwner = minutes.preparedBy === userId || meeting.hostId === userId`, có unit test riêng cho 4 tổ hợp (đúng/sai × preparedBy/hostId) |
| `versionNo` conflict cần trả đủ `currentData` để FE reload, dễ quên field | Đối chiếu spec.md mục 6.4 làm checklist khi build error response |
| Refresh `attendeesSnapshotJson` chỉ khi `meeting.status = completed` — dễ nhầm điều kiện (refresh cả khi in_progress) | Test riêng 2 case: completed (có refresh) và in_progress (không refresh), assert rõ ràng dữ liệu snapshot không đổi ở case thứ 2 |
| Action items cần giữ `id` ổn định qua nhiều lần update (không sinh lại `id` cho item cũ) | FE luôn gửi lại toàn bộ mảng `actionItemsJson` (kể cả item không đổi) kèm `id` cũ nếu có; server chỉ tự sinh `id` cho item KHÔNG có `id` trong request |
| Permission code lệch giữa code hiện tại (`meeting.minutes.*`) và API_CONTRACT (`minutes.*`) | Đi theo code hiện tại, ghi rõ deviation trong spec.md để review không hiểu nhầm là thiếu sót |

## 8. Kết luận
Không có unknown nào chặn việc viết plan.md. Một điểm cần Codex-implementation tự xác minh lại trước khi code (không phải unknown nghiệp vụ, mà là rủi ro kỹ thuật khi đọc code hiện tại): cấu trúc thật của `minutes.service.ts` quanh method `findMinutesList` (xem mục 5).
