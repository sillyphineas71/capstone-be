# Research: Export Meeting Minutes (UC-147)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo research cho feat-export-meeting-minutes (UC-147), ghi lại phát hiện hạ tầng đã provision sẵn + Q&A đã chốt | Toàn bộ file |

## 1. Nguồn UC gốc và cross-reference sai trong Feature Table

Feature Table gốc ghi "Related Use Cases: UC-90, UC-91" cho UC-147. Tra trong `docs/API_CONTRACT_v1.0_with_system_roles.md`:
- **UC-90** (dòng 3289) = "Xem timeline hiện diện cuộc họp" (`GET /meetings/{id}/presence-timeline`, permission `attendance.presence.read`) — thuộc module Attendance/Presence.
- **UC-91** (dòng 3325) = "Chỉnh sửa hồ sơ điểm danh thủ công" (alias `PATCH /attendance-records/{id}`, UC-80) — cũng thuộc Attendance.

Không UC nào liên quan tới biên bản họp. Xác nhận đây là cross-reference sai/cũ trong Feature Table gốc — vấn đề đã lặp lại nhiều lần (tương tự đã ghi nhận ở `feat-link-minutes-resources/research.md`, `feat-view-minutes-attachment-detail/spec.md`). Dependency logic thực sự: UC-146 "Phân phối biên bản cuộc họp" (đứng ngay trước UC-147, dòng 4741) + biên bản phải đã tồn tại và ban hành (`feat-issue-meeting-minutes`).

## 2. Phát hiện quan trọng: hạ tầng async-export đã được provision sẵn từ trước, chưa từng dùng

Đây là phát hiện lớn nhất của research này — 4 thành phần rời rạc, không liên quan trực tiếp tới nhau khi đọc riêng lẻ, nhưng khi ghép lại xác nhận rõ ràng feature này **đã được thiết kế trước, chỉ chưa implement**:

1. `MeetingMinutesEntity.fileId` (`meeting-minutes.entity.ts:96-97`, cột `file_id` uuid nullable) — không có feature nào khác trong module `minutes` từng ghi cột này (`feat-attach-minutes-document/spec.md` xác nhận rõ: "`meeting_minutes.file_id` — reserved cho export feature, ngoài phạm vi").
2. `MediaFileType.EXPORT` (`media-file.entity.ts`) — enum value có sẵn, `grep -rn "MediaFileType.EXPORT"` chỉ match ở `reports/processors/meeting-activity-report-worker.processor.ts` (dùng cho export report, KHÔNG phải minutes) — chưa từng dùng cho minutes.
3. `BackgroundJobType.EXPORT_MINUTES = 'export_minutes'` (`background-job.entity.ts:17`) — enum value có sẵn, đứng cạnh `EXPORT_REPORT = 'export_report'` (dòng 16, đang được dùng bởi `reports` module) — `EXPORT_MINUTES` chưa từng được reference ở đâu khác trong `src/`.
4. Queue BullMQ `'minutes-export'` — **đã đăng ký đầy đủ** trong `queue.module.ts` (dòng 98-101, `QUEUE_MINUTES_EXPORT_NAME` provider, default queue name `'minutes-export'`, env override `QUEUE_MINUTES_EXPORT`) và `queue.service.ts` (dòng 51, 97-98, inject vào `QueueService.minutesExportQueue`, thêm vào `queueMap`). Không có `@Processor('minutes-export')` nào tồn tại trong `src/` — queue này hiện **không có worker nào lắng nghe**, nghĩa là nếu ai đó gọi `queueService.addJob('minutes-export', ...)` ngay bây giờ, job sẽ nằm im vĩnh viễn ở trạng thái `waiting` trong Redis.

Kết luận: người thiết kế database/queue baseline (DB v3.2 Compact + `QueueModule`) đã chủ động chừa chỗ cho UC-147 nhưng chưa ai triển khai controller/service/worker. Đây KHÔNG phải trường hợp "tính năng chưa cần thiết" — nó đã nằm sẵn trong kế hoạch kiến trúc, chỉ đang chờ implement.

## 3. Pattern mẫu: module `reports` (`export:meeting-activity`, `export:room-utilization`)

Module `reports` (`src/modules/reports/`) là bản triển khai đầy đủ, chạy thật, của đúng pattern `background_jobs + media_files` mà CLAUDE.md §5.3/§19/§22.13 mô tả cho mọi tính năng export trong dự án. Cấu trúc:
```text
controllers/*-report.controller.ts   → POST .../exports, @RequirePermissions, trả 202+jobId
dto/create-*-export.dto.ts           → format enum + scope/filter fields
services/*-report.service.ts         → validate + createQueuedJob + queueService.addJob
processors/*-report-worker.processor.ts → @Processor(QUEUE_NAME), markRunning→render→saveFile→
                                          tạo MediaFileEntity→markCompleted→update output_file_id,
                                          catch→markFailed (KHÔNG throw tiếp)
renderers/*-pdf-renderer.ts          → dùng pdfkit, trả Promise<Buffer>
renderers/*-xlsx-renderer.ts         → dùng exceljs, trả Promise<Buffer>
constants/*-job.constants.ts         → QUEUE_NAME, JOB_NAME string constants
```
Feature này (UC-147) mirror gần như 1:1 cấu trúc trên, đặt trong module `minutes` thay vì `reports` (đúng module boundary — xem mục 5) và dùng queue `minutes-export`/job type `EXPORT_MINUTES` đã có sẵn thay vì `report-export`/`EXPORT_REPORT`.

## 4. Q&A đã chốt (research trước khi hỏi Product Owner qua AskUserQuestion)

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | Format: chỉ PDF hay cả PDF+Word? | **Cả hai** — Product Owner chọn "Cả PDF và Word ngay từ đầu" (khác đề xuất mặc định ban đầu là "chỉ PDF trước"). Cần thêm dependency `docx` (npm) — dự án hiện chỉ có `pdfkit`/`exceljs`. |
| 2 | Ai được request export? | **Host/Preparer + Business Admin** — Product Owner xác nhận đúng đề xuất mặc định, dùng lại nguyên OR-rule ownership đã có ở `feat-issue-meeting-minutes` (`preparedBy OR meeting.hostId OR Admin`). |
| 3 | Biên bản `draft` có export được không? | Không — chỉ `published`. Đề xuất mặc định, chưa bị phản đối. Lý do: "biên bản" đúng nghĩa là văn bản chính thức; `draft` còn sửa được nên export ra dễ gây hiểu nhầm là bản cuối. |
| 4 | `meeting_minutes.file_id` có ghi đè mỗi lần export không? | Không luôn luôn — chỉ export "mặc định" (đủ include-option, format=pdf) mới ghi `file_id`. Tránh 1 cột 1-1 bị cướp bởi lần export tùy biến gần nhất. |
| 5 | Queue đặt ở đâu? | Đã có sẵn — dùng nguyên `minutes-export` (không cần tạo mới, không cần quyết định lại vì hạ tầng đã fix cứng tên này từ trước). |
| 6 | Permission code dùng tên nào? | `meeting.minutes.export` — theo đúng convention `meeting.minutes.<action>` đã dùng nhất quán cho MỌI permission khác của module `minutes` (`read/update/delete/issue/attachment.*/link_resources`), khác `minutes.export` ghi trong API Contract gốc (sai khác có chủ đích, đã lặp lại ở tất cả feature `minutes` trước đó — không phải lần đầu). |

## 5. Vì sao đặt trong module `minutes`, không mở rộng module `reports`?

CLAUDE.md §4.1 định nghĩa `minutes` = "Meeting minutes, decisions, action_items_json" và `reports` = "Report output via background_jobs + media_files". Một file export biên bản là **bản sao/phái sinh của 1 bản ghi `meeting_minutes` cụ thể đã tồn tại** (không phải số liệu tổng hợp/phân tích từ nhiều nguồn như `reports`), nên về mặt domain nó thuộc sở hữu của `minutes`, chỉ *tái sử dụng cùng pattern kỹ thuật* (`background_jobs`+`media_files`+BullMQ) với `reports` chứ không phải cùng bounded context. Việc queue `minutes-export` đã được đặt tên/đăng ký riêng (khác `report-export`) từ trước càng củng cố quyết định này — người thiết kế baseline rõ ràng cũng nghĩ vậy.

## 6. Có cần bảng/cột/enum mới không?
**Không.** Toàn bộ cột/enum cần dùng (`file_id`, `MediaFileType.EXPORT`, `BackgroundJobType.EXPORT_MINUTES`, queue `minutes-export`) đã có sẵn trong baseline. Chỉ cần: 1 migration seed permission mới (`meeting.minutes.export`) + 1 npm dependency mới (`docx`).

## 7. Rủi ro & quyết định thiết kế
| Rủi ro | Quyết định |
| :--- | :--- |
| Thư viện `docx` chưa từng dùng trong dự án, API khác hẳn `pdfkit` | Renderer tách file riêng, test độc lập trước khi tích hợp worker (xem plan.md mục 12) |
| Vô tình ghi đè `file_id` cho MỌI lần export thay vì chỉ export mặc định | Tách rõ điều kiện `isDefaultExport` thành biến/hàm riêng, test riêng AC-005/AC-006 |
| Queue `minutes-export` đã đăng ký sẵn nhưng dễ quên rằng cần khai báo `@Processor` đúng trong `minutes.module.ts` (không phải tự tạo `BullModule.registerQueue` mới — sẽ conflict với queue đã đăng ký global) | Đọc kỹ `queue.module.ts` trước khi code, chỉ thêm `MinutesExportWorkerProcessor` như 1 provider bình thường trong `MinutesModule`, KHÔNG registerQueue lại |
| Copy nhầm điều kiện status từ `feat-issue-meeting-minutes` (status=`draft`→`published`) sang export (phải là status=`published` làm điều kiện, không phải transition) | Đọc kỹ FR-009 trong spec.md trước khi code, test riêng AC-010/AC-011 |

## 8. Kết luận
Không có unknown nào chặn việc viết plan.md/tasks.md. 2 điểm mơ hồ có tác động lớn nhất tới scope (format, quyền export) đã được Product Owner xác nhận trực tiếp qua AskUserQuestion. Các điểm còn lại dùng đề xuất mặc định hợp lý, nhất quán với pattern đã có ở `feat-issue-meeting-minutes`/`reports` module, không còn `[NEEDS CLARIFICATION]` nào mở trong spec.md.
