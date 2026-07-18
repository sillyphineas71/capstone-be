# Implementation Plan: View Minutes Attachment Detail

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo plan, viết sau khi implement (retro-documentation theo yêu cầu speckit) | Toàn bộ file |

## 1. Feature Summary
Bổ sung trường `downloadUrl` (Signed URL) vào response có sẵn của `GET /api/v1/media-files/:fileId` (UC-121, tái sử dụng cho UC-140), vá 2 lỗ hổng phân quyền (role `EMPLOYEE` bị thiếu do bug seed `INTERNAL_USER`, role `BUSINESS_ADMIN` thiếu `recording.files.read`), và thêm filter `meetingId` cho `GET /meeting-minutes` để hỗ trợ luồng FE meeting → minutes → attachments.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, không migration schema mới (chỉ migration seed permission). Không dùng Prisma.

### 2.2 Existing Codebase Analysis
- `src/modules/recording/services/media-files.service.ts`: method `detail()` (dòng ~78) đã trả đầy đủ metadata nhưng thiếu `downloadUrl`. Không có `StorageService` injected trước đây — cần thêm vào constructor.
- `src/modules/recording/controllers/media-files.controller.ts`: đã inject `StorageService` (dùng cho `secureDownload`) nhưng route `detail()` (dòng 53-64) không dùng tới — không cần sửa controller, chỉ sửa service.
- `src/modules/storage/storage.service.ts`: `generateSignedDownloadToken(mediaFileId, ttlSeconds)` (dòng ~306) đã tồn tại, dùng bởi `AdminAvatarReviewService.getAvatarDownloadUrl` (`src/modules/accounts/services/admin-avatar-review.service.ts` dòng ~195-243) — **pattern kỹ thuật tham khảo chính** cho cách build `downloadUrl` (base URL từ `API_PUBLIC_BASE_URL`, ttl từ `MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`).
- `src/modules/minutes/dto/minutes-query.dto.ts` + `src/modules/minutes/services/minutes.service.ts` (`findMinutesList`): thêm field/filter `meetingId`, join `meeting` đã có sẵn trong query builder (`leftJoin('minutes.meeting', 'meeting')`) — chỉ cần thêm 1 `andWhere`.
- `src/modules/minutes/services/minutes.service.ts` (`listAttachments`, `loadMinutesForOwnerCheck`): cần đổi sang quyền đọc rộng hơn (`loadMinutesForReadCheck` mới, dùng `canAccessMinutes` đã có sẵn trong cùng file, được `findMinutesDetail` dùng) — xem `feat-attach-minutes-document` (đã cập nhật) cho chi tiết đầy đủ, feature này chỉ tham chiếu.
- `src/database/seeds/20260615000009-SeedMediaFilesPermissions.ts` + `src/database/seeds/20260704000002-SeedCameraDomainRbacPermissions.ts`: 2 nguồn seed cho `recording.files.read`, nguồn thứ 2 (migration thật, chạy được) chỉ cấp `SYSTEM_ADMIN, MANAGER, EMPLOYEE` — thiếu `BUSINESS_ADMIN`.
- `src/database/migrations/20260711000001-SeedRecordingUploadTrackEmployeeRole.ts`: **tiền lệ đã có** cho việc phát hiện + vá role code `INTERNAL_USER` không tồn tại (role thật `EMPLOYEE`) — dùng làm khuôn mẫu cho migration vá của feature này.

### 2.3 Patterns to Follow
- Build `downloadUrl` giống hệt `AdminAvatarReviewService.getAvatarDownloadUrl`: base URL từ config (`API_PUBLIC_BASE_URL`, default `http://localhost:3000`), ttl từ config (`MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`, default 600), gọi `storageService.generateSignedDownloadToken(fileId, ttl)`, ghép URL `{baseUrl}/api/v1/media-files/{fileId}/secure-download?token={token}`.
- Khác với avatar-review: **không throw** nếu sinh token lỗi — chỉ log warning + trả `null` (FR-006 của spec.md), vì đây là 1 field phụ trong response chi tiết, không phải toàn bộ mục đích của request như bên avatar-review.
- Migration vá permission: copy đúng khuôn `20260711000001-SeedRecordingUploadTrackEmployeeRole.ts` (đọc `permissions.id` theo `permission_code`, `INSERT INTO role_permissions ... SELECT r.id FROM roles r WHERE r.role_code = :role ON CONFLICT DO NOTHING`, có `down()` đối xứng).

## 3. Scope Confirmation

### 3.1 In Scope
- Thêm `downloadUrl` vào `MediaFilesService.detail()`.
- Migration vá `recording.files.read` cho `BUSINESS_ADMIN`.
- Migration vá 4 permission minutes (`meeting.minutes.read` + 3 permission attachment) cho `EMPLOYEE` (role thật thay cho `INTERNAL_USER`).
- Đổi `listAttachments` sang `loadMinutesForReadCheck` (chi tiết đầy đủ ở `feat-attach-minutes-document`).
- Filter `meetingId` cho `GET /meeting-minutes`.
- Unit test cho tất cả thay đổi trên.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — token ký HMAC, secret từ env, không log |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard (không đổi, chỉ vá role thiếu) |
| SEC-03 (input validation) | PASS — `ParseUUIDPipe` cho `fileId` (đã có) |
| DATA-01 (soft-delete) | N/A — không đổi data lifecycle |
| ARCH-01 (service boundary) | PASS — chỉ inject `StorageService` (đã `@Global()`) vào `MediaFilesService`, không gọi chéo module `minutes` |
| ARCH-02 (async cho >2s) | PASS — sinh token đồng bộ, rẻ |
| ARCH-03 (idempotency) | PASS — GET thuần, không có side effect |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Không đổi (route/response shape cũ giữ nguyên, chỉ thêm field) |
| ENG-03 (error không lộ stack trace) | PASS |

### 3.4 Complexity Tracking
Không có complexity bất thường. Điểm cần lưu ý: migration vá lần này là migration **thứ 2** vá cùng loại bug (`INTERNAL_USER` không tồn tại) sau `20260711000001` — đã tạo task nền riêng để rà soát toàn bộ ~24 chỗ còn lại (ngoài phạm vi feature này).

## 4. Data Model Impact
0 bảng mới, 0 cột mới, 2 migration seed permission mới (không phải bảng), 1 query filter mới (không phải schema).

### 4.1 Bảng bị ảnh hưởng
Không có bảng nào bị đổi cấu trúc. `role_permissions` được INSERT thêm dòng qua migration (dữ liệu, không phải schema).

### 4.2 Bảng được INSERT
`role_permissions` (qua 2 migration mới, không phải runtime).

### 4.3 Seed / Migration
- `20260717000001-FixMinutesAttachmentEmployeeRole.ts`: cấp `meeting.minutes.read`, `meeting.minutes.attachment.create/read/delete` cho `EMPLOYEE`.
- `20260717000002-SeedRecordingFilesReadBusinessAdmin.ts`: cấp `recording.files.read` cho `BUSINESS_ADMIN`.
- Cả 2 chạy qua `npm run migration:run:tsx` (không dùng `npm run migration:run` — bị lỗi module resolution `ts-node`/NodeNext trong môi trường dev này, xem ghi chú trong `scripts/run-migrations.ts`).

## 5. API / Contract Plan

### 5.1 Endpoints
- `GET /api/v1/media-files/:fileId` (không đổi route, chỉ thêm field `downloadUrl` trong response).
- `GET /api/v1/meeting-minutes?meetingId=:uuid` (thêm query param optional vào endpoint đã có).

### 5.2 Request
Xem spec.md mục 5.2.

### 5.3 Success Response
`200 OK` cho cả 2 endpoint — xem spec.md mục 5.3.

### 5.4 Error Responses
`400` (UUID không hợp lệ), `401 Unauthorized`, `403 FORBIDDEN`, `404 MEDIA_FILE_NOT_FOUND` — không có error code mới, kế thừa từ UC-121.

## 6. Authorization Plan

### 6.1 Permission Design
Không tạo permission mới — chỉ vá role_permissions còn thiếu cho permission đã tồn tại (`recording.files.read`, `meeting.minutes.read`, `meeting.minutes.attachment.*`).

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('recording.files.read')` — không đổi decorator, chỉ đổi role_permissions dữ liệu.
3. Service `detail()` không có thêm resource-level check (xem spec.md mục 2.3/8.1 về rủi ro đã biết, chấp nhận ở v1).

### 6.3 Error
Thiếu permission → 403 `FORBIDDEN` (guard). Không có lỗi ownership riêng ở tầng UC-140.

## 7. Business Logic Plan

### 7.1 `MediaFilesService.detail()` — bổ sung downloadUrl
```text
1. loadActive(fileId) -> 404 MEDIA_FILE_NOT_FOUND nếu thiếu/đã xóa (không đổi)
2. buildSignedDownloadUrl(mediaFile):
   a. NẾU storageProvider === CLOUD_PROVIDER -> return fileUrl ?? null
   b. NGƯỢC LẠI:
      - baseUrl = config.get('API_PUBLIC_BASE_URL', 'http://localhost:3000')
      - ttl = config.get('MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS', 600)
      - TRY: signed = storageService.generateSignedDownloadToken(id, ttl)
             return `${baseUrl}/api/v1/media-files/${id}/secure-download?token=${signed.token}`
      - CATCH: log.warn(...); return null
3. Trả object cũ + { downloadUrl }
```

### 7.2 `MinutesService.findMinutesList()` — filter meetingId
```text
Nếu queryDto.meetingId có giá trị:
  qb.andWhere('meeting.id = :meetingId', { meetingId: queryDto.meetingId })
(đặt cạnh filter roomId đã có, cùng cấp AND — không thay đổi scope rule theo role)
```

### 7.3 Key Business Rules Implemented
`downloadUrl` không bao giờ làm fail request chi tiết (lỗi sinh token bị nuốt, log warning). Filter `meetingId` không ảnh hưởng scope rule theo vai trò (Admin/Host/Participant) đã có ở `findMinutesList` — chỉ thu hẹp thêm theo AND.

## 8. Validation Plan

### 8.1 Input Validation
- `fileId` — `ParseUUIDPipe` (đã có, không đổi).
- `meetingId` (query, mới) — `@IsOptional() @IsUUID('4')` trong `MinutesQueryDto`.

### 8.2 Business Validation (Service)
Không có business validation mới ngoài việc query filter thêm.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| `fileId` không tồn tại/đã xóa | `NotFoundException` (đã có) | `MEDIA_FILE_NOT_FOUND` |
| Sinh signed token lỗi | Không throw — log warning, `downloadUrl = null` | — |

### 9.2 Transaction Error Handling
Không áp dụng — toàn bộ là GET, không có transaction.

### 9.3 Notification Error (Non-blocking)
Không áp dụng.

## 10. Testing Strategy

### 10.1 Unit Tests
`media-files.service.spec.ts` (bổ sung 3 case): storage local → `downloadUrl` chứa `secure-download?token=`; storage `cloud_provider` → `downloadUrl = fileUrl`; sinh token lỗi → `downloadUrl = null`, không throw.

`minutes.service.spec.ts` (bổ sung 5 case cho `loadMinutesForReadCheck` qua `listAttachments`, xem `feat-attach-minutes-document/tasks.md`).

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test thật qua DB dev: login user role `EMPLOYEE`, gọi `GET /meeting-minutes?meetingId=X`, `GET /meeting-minutes/:id/attachments`, `GET /media-files/:fileId`, xác nhận không còn 403 sau khi chạy 2 migration vá.

### 10.3 Permission Seed Test
Không có unit test riêng cho migration (nhất quán với các migration permission khác trong repo) — verify bằng cách chạy `npm run migration:run:tsx` thật trên DB dev + gọi API thật qua JWT của user role `EMPLOYEE`/`BUSINESS_ADMIN` (đã làm khi build feature này, xác nhận permissions xuất hiện đúng trong JWT `/auth/login` response).

## 11. Implementation Phases

### Phase 1: Service Logic
`MediaFilesService.buildSignedDownloadUrl()` + inject `StorageService`; `MinutesQueryDto.meetingId` + `findMinutesList` filter.

### Phase 2: Access Control Fix
`MinutesService.loadMinutesForReadCheck()` (chi tiết ở `feat-attach-minutes-document`).

### Phase 3: Permission Migrations
`20260717000001-FixMinutesAttachmentEmployeeRole.ts`, `20260717000002-SeedRecordingFilesReadBusinessAdmin.ts`.

### Phase 4: Tests & Verification
Unit test 2 service, chạy migration thật trên DB dev, verify qua JWT login response + gọi API thật.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| `downloadUrl` sai định dạng khi `STORAGE_DRIVER=s3` do bug riêng ở `addAttachment` (storageProvider luôn `local`) | Đã ghi rõ ở spec.md mục 1.5/8.1, tách task riêng, không sửa lẫn vào feature này để giữ phạm vi rõ ràng |
| Còn ~24 chỗ khác trong migrations dùng role `INTERNAL_USER` không tồn tại (ngoài 2 migration đã vá ở feature này + 1 cái trước đó) | Tách task nền riêng để rà soát toàn bộ, không mở rộng phạm vi feature này |
| Endpoint `GET /media-files/:fileId` không kiểm tra resource-level ownership theo `meeting_minutes` (chỉ dựa vào permission chung) | Ghi rõ là rủi ro đã biết ở spec.md mục 8.1, chấp nhận ở v1 (giống hành vi gốc UC-121), đề xuất feature riêng nếu cần vá sau |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`. Viết **sau khi** code đã implement và test đã pass (retro-documentation) — khác quy trình thông thường (spec trước, code sau) vì tính năng được yêu cầu bổ sung tài liệu sau khi đã hoàn thành, theo yêu cầu trực tiếp của người dùng ngày 2026-07-17.
