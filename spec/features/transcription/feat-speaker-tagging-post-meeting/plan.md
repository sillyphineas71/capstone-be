## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo plan.md ban đầu, đối chiếu spec.md với code thật (`transcription.service.ts`, `transcript-segments.controller.ts`, migration mẫu). | Toàn bộ file (mới) |

# Implementation Plan: TRANS-SPEAKER-TAG-POST-001 Speaker Tagging — Post-Meeting

**Branch**: `feat-speaker-tagging-post-meeting` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `spec/features/transcription/feat-speaker-tagging-post-meeting/spec.md`
**Nguồn quyết định gốc**: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` GIAI ĐOẠN 2

> **Đây là bước documentation-first. Không có code nào được viết trong phạm vi plan.md này.**

## 1. Feature Summary

Thêm 2 endpoint mới vào module `transcription` (base path `transcripts`, đúng pattern `TranscriptSegmentsController` đã có): `POST /transcripts/:transcriptId/speaker-mappings` (gán hàng loạt) và `GET /transcripts/:transcriptId/speaker-clusters` (đọc danh sách cụm cho FE dựng UI chọn). Thêm `MeetingEventType.SPEAKER_TAG` vào enum có sẵn (không DDL). Sửa `updateTranscriptResult()` (đã có trong `transcription.service.ts`) để tự động áp lại mapping từ `meeting_events` ngay sau khi ghi transcript draft mới — đây là điểm mấu chốt khiến việc gán tay "sống sót" qua mọi lần chạy lại.

## 2. Technical Context

**Language/Version**: TypeScript/NestJS — không đổi, cùng codebase với `feat-offline-local-transcription-pipeline`.
**Primary Dependencies**: Không thêm dependency mới — dùng lại `TypeOrmModule`, `DataSource` raw query pattern đã có trong `transcription.service.ts`.
**Storage**: PostgreSQL — bảng `transcripts`, `meeting_events`, `recording_sessions`, `meeting_external_participants`, `users`, `permissions`/`role_permissions` đều đã có, KHÔNG migration schema (chỉ migration DATA để seed permission, theo đúng tiền lệ).
**Testing**: Jest (unit test service logic — tính mốc đại diện, gộp/mâu thuẫn, áp lại khi rerun).
**Target Platform**: Không đổi (NestJS backend, cùng deployment với các module khác).
**Project Type**: Mở rộng module `transcription` hiện có — controller mới, service method mới trong `TranscriptionService` (không tạo service riêng, tránh phân mảnh logic transcript).
**Constraints**:
- Không tạo bảng/cột mới.
- Không sửa Python worker.
- Permission mới PHẢI seed bằng migration trong `src/database/migrations/`, không dùng `seeds/`.
- Toàn bộ authz phải theo đúng pattern Host-of-meeting-or-Admin đã lặp lại 6+ lần trong `transcription.service.ts` — không phát minh cơ chế mới.

**Scale/Scope**: 1 controller mới (`transcript-speaker-mappings.controller.ts`), 2 DTO mới, ~4 method mới trong `TranscriptionService` (hoặc tách thành `speaker-mapping.service.ts` riêng — xem mục 4 quyết định kiến trúc), 1 migration seed permission, sửa 1 method có sẵn (`updateTranscriptResult`).

## 3. Constitution Check

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Không thêm bảng database mới | ✅ PASS | Dùng `meeting_events` có sẵn |
| Không thêm cột mới | ✅ PASS | `event_type` là `varchar(60)`, không DDL |
| Seed permission bằng migration, không dùng `seeds/` | ⚠️ GATE BẮT BUỘC | Bài học đã ghi trong project memory — bỏ qua sẽ 403 |
| Không dùng Prisma / không đổi ORM | ✅ PASS | TypeORM |
| Không tự ý thêm Kafka/Elastic/vector DB | ✅ PASS | |
| Không sửa Python worker | ✅ PASS | Feature thuần NestJS |
| Markdown editing safety | ✅ PASS | |

Không có vi phạm cần justify.

## 4. Quyết định kiến trúc: Service riêng hay method trong `TranscriptionService`?

`TranscriptionService` hiện đã khá lớn (~900 dòng, theo grep trước đó `isAdminRole` ở dòng 900). Thêm ~4 method mới (tính mốc đại diện, ghi mapping, đọc cụm, áp lại khi rerun) vào cùng file sẽ làm file phình to hơn nữa.

**Quyết định**: tạo **service riêng** `SpeakerMappingService` (`src/modules/transcription/services/speaker-mapping.service.ts`), inject `TranscriptEntity`/`MeetingEventEntity`/`RecordingSessionEntity`/`MeetingExternalParticipantEntity`/`UserEntity` repository trực tiếp (không phụ thuộc `TranscriptionService`), và **tái sử dụng logic authz Host-of-meeting-or-Admin** bằng cách copy-pattern (không import chéo `TranscriptionService` để tránh phụ thuộc vòng nếu sau này `TranscriptionService` cần gọi ngược `SpeakerMappingService` cho GA-27).

**Lý do**: (a) tránh làm phình thêm file đã lớn, (b) tách rõ trách nhiệm — "chạy pipeline AI" khác "quản lý mapping danh tính", dễ test độc lập, (c) tiền lệ trong module này đã có nhiều service nhỏ (`BackgroundJobsService` tách khỏi `TranscriptionService` dù cùng domain).

**Ngoại lệ — GA-27 (áp lại khi rerun)**: method `applySpeakerMappingsFromEvents()` được implement TRONG `SpeakerMappingService`, nhưng được **GỌI TỪ** `TranscriptionService.updateTranscriptResult()` (nơi transcript draft mới vừa được ghi) — nghĩa là `TranscriptionModule` cần export `SpeakerMappingService` và `TranscriptionService` inject nó. Đây là phụ thuộc MỘT CHIỀU (Transcription → SpeakerMapping), không vòng.

## 5. Vị trí chèn code cụ thể

### 5.1 `meeting-event.entity.ts` — thêm enum value

```ts
export enum MeetingEventType {
  // ... các giá trị đã có ...
  SPEAKER_TAG = 'speaker_tag',  // MỚI — feat-speaker-tagging-post-meeting
}
```

Kèm migration tài liệu hoá (không DDL), đúng mẫu `20260617-UpdateMeetingEventTypeEnum.ts`.

### 5.2 `transcription.service.ts` — điểm chèn gọi GA-27

Method `updateTranscriptResult()` (dòng 378-422 hiện tại) kết thúc bằng ghi `transcriptRepo.update(transcriptId, {...status: DRAFT...})`. Chèn NGAY SAU đó:

```ts
await this.transcriptRepo.update(transcriptId, { ...status: DRAFT... });
// GA-27 — áp lại mapping đã gán từ meeting_events (nếu có), best-effort.
try {
  await this.speakerMappingService.applySpeakerMappingsFromEvents(transcriptId);
} catch (err) {
  this.logger.warn('applySpeakerMappingsFromEvents FAILED (best-effort, khong fail job): ' + err.message);
}
this.logger.log('Transcript ' + transcriptId + ' updated to draft ...');
```

Theo đúng tinh thần fail-safe đã dùng cho `notifyTranscriptReady()` (T029, feature trước) — lỗi áp mapping KHÔNG được làm fail job transcription đã thành công (NFR-004 spec.md).

### 5.3 File mới

Đối chiếu thư mục thật của module (`ls src/modules/transcription/`): cấu trúc **FLAT**, controller/service nằm trực tiếp trong `transcription/` (không có subfolder `services/`/`controllers/` — khác template chung ở CLAUDE.md mục 6.1, nhưng module này đã tự chọn flat từ đầu, giữ nhất quán với `transcript-segments.controller.ts` sẵn có thay vì áp template chung):

```text
src/modules/transcription/speaker-mapping.service.ts             (mới)
src/modules/transcription/speaker-mapping.service.spec.ts        (mới)
src/modules/transcription/transcript-speaker-mappings.controller.ts (mới)
src/modules/transcription/dto/create-speaker-mappings.dto.ts     (mới)
src/modules/transcription/dto/speaker-cluster-response.dto.ts    (mới)
src/database/migrations/<timestamp>-SeedTranscriptSpeakerTagPermission.ts (mới)
```

### 5.4 Dependency injection — đã sẵn sàng, KHÔNG cần sửa `transcription.module.ts` imports

Đã xác nhận qua đọc code thật: `MeetingEventEntity` và `MeetingExternalParticipantEntity` đã đăng ký trong `MeetingsModule` (`TypeOrmModule.forFeature([...])`, dòng ~53-66), `RecordingSessionEntity` đã đăng ký trong `RecordingModule`, `UserEntity` đã đăng ký trong `AccountsModule` — cả ba module đều `exports: [TypeOrmModule]` và đều **đã được `TranscriptionModule` import sẵn** (`imports: [AccountsModule, MeetingsModule, RecordingModule, ...]`). Do đó `SpeakerMappingService` có thể `@InjectRepository(MeetingEventEntity)`/`@InjectRepository(RecordingSessionEntity)`/`@InjectRepository(MeetingExternalParticipantEntity)`/`@InjectRepository(UserEntity)` trực tiếp mà **không cần thêm bất kỳ import nào vào `transcription.module.ts`** — chỉ cần đăng ký `SpeakerMappingService` vào mảng `providers` và `transcript-speaker-mappings.controller.ts` vào `controllers`.

## 6. Thuật toán tính mốc đại diện & áp lại (tóm tắt kỹ thuật, không lặp lại spec)

- **Ghi (GA-21)**: với mỗi `speakerLabel` cần gán, lọc `speaker_segments_json.segments` có `speakerLabel` khớp, chọn segment có `endMs - startMs` lớn nhất, `representativeOffsetMs = (startMs + endMs) / 2` của segment đó. `event_time = recording_sessions.started_at + representativeOffsetMs` (cộng mili-giây vào Date).
- **Đọc/áp lại (GA-27)**: với mỗi `meeting_events` loại `speaker_tag` có `metadata_json.recordingSessionId` khớp recording session của transcript đang xử lý, tính `offsetMs = event.event_time - recording_sessions.started_at` (cùng session), tìm segment trong transcript MỚI mà `segment.startMs <= offsetMs < segment.endMs`, lấy `speakerLabel` của segment đó làm đích áp mapping.
- **Gộp/mâu thuẫn**: gom các `meeting_events` áp dụng theo đích `speakerLabel` MỚI vừa tìm được — nếu 1 đích có nhiều nguồn nhưng cùng identity → áp bình thường; nếu nhiều identity khác nhau → conflict (ERR-TAG-003), không áp cho đích đó.

## 7. Rủi ro triển khai

| Rủi ro | Biện pháp |
|---|---|
| `SpeakerMappingService` cần đọc `speaker_segments_json`/`detected_speakers_json` dạng `Record<string, unknown>` (JSONB không strict-typed ở tầng entity) — dễ lỗi runtime nếu shape sai | Viết type guard/interface nội bộ khớp `TranscriptionResult`/`schemas.py` đã có, KHÔNG dùng `any` tràn lan (đúng CLAUDE.md mục 26.2) |
| Ghi đè `detected_speakers_json` có thể làm mất field khác không liên quan nếu implement cẩu thả (spread sai) | Test riêng: ghi mapping xong, các field KHÔNG liên quan (`totalSpeakingMs`, `segmentCount`, `confidence`) phải giữ nguyên |
| GA-27 chạy mỗi lần rerun — nếu recording session có RẤT NHIỀU `meeting_events` qua nhiều lần gán/nhiều lần rerun, performance vòng lặp O(events × segments) | Chấp nhận cho MVP (số lượng event/segment nhỏ, vài chục), không tối ưu sớm — đúng nguyên tắc "không over-engineering" |
