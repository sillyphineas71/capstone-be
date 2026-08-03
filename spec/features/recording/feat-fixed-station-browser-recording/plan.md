## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-03 | Tạo plan.md ban đầu, đối chiếu spec.md với code thật của `SpeakerMappingService`/`RecordingSessionService` (đã implement ở GIAI ĐOẠN 2/REC-002..005). Phát hiện khi viết plan: `recording_sessions.duration_seconds` có thể `null` (ffprobe lỗi) — ảnh hưởng validate FR-015, đưa vào mục 6 "Cần chốt". | Toàn bộ file (mới) |

# Implementation Plan: REC-006 Fixed-Station Browser Recording

**Branch**: `feat-fixed-station-browser-recording` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)
**Input**: `spec/features/recording/feat-fixed-station-browser-recording/spec.md`
**RECON gốc**: [research.md](./research.md) (D-1..D-8)

> **Đây là bước documentation-first. Không có code nào được viết trong phạm vi plan.md này.**

## 1. Feature Summary

Hai phần độc lập, ghép lại ở điểm nối `recordingSessionId`:

1. **BE (nhỏ)**: thêm đúng 1 method mới `SpeakerMappingService.createOffsetSpeakerMarks()` + 1 route mới trong module `transcription` (cùng chỗ với GA-30/32/35, KHÔNG đụng module `recording`) — nhận mảng mốc gán tên kèm `offsetSeconds` tường minh do FE tự tính, ghi `meeting_events` với `tagSource='post'` bằng anchor `recording_sessions.started_at` đã có sẵn ngay sau khi `audio-upload` xong. **Không sửa `applySpeakerMappingsFromEvents()`** — vì `tagSource='post'` đã được xử lý đúng từ GIAI ĐOẠN 2.
2. **FE (lớn, mới hoàn toàn)**: chức năng ghi âm trực tiếp bằng `MediaRecorder` + lưu đoạn xuống IndexedDB tại trạm cố định, hiển thị theo cờ `rooms.has_microphone`, tái dùng nguyên endpoint `audio-upload` để upload, rồi gọi endpoint BE mới ở trên để gửi mốc gán tên đã thu thập trong lúc họp.

## 2. Technical Context

**Language/Version**: TypeScript/NestJS (BE, không đổi). React 18 + Create React App/`react-scripts` (FE `FE_SmarTracking`, không đổi).
**Primary Dependencies**:
- BE: KHÔNG thêm — `SpeakerMappingService` đã inject sẵn `recordingSessionRepo`, `meetingEventRepo`, `meetingRepo`, `externalParticipantRepo`, `userRepo`, `dataSource` (đủ cho toàn bộ method mới, không cần sửa `transcription.module.ts` providers).
- FE: dùng Web API gốc trình duyệt (`MediaRecorder`, `indexedDB`) — KHÔNG thêm thư viện ngoài (package.json hiện không có wrapper IndexedDB nào như `idb`; quyết định giữ nguyên, dùng API gốc để không thêm dependency mới cho một thao tác đơn giản: put/get theo key).
**Storage**: PostgreSQL — KHÔNG DDL, dùng nguyên `meeting_events`/`recording_sessions`/`media_files`/`rooms.has_microphone`. IndexedDB phía trình duyệt — tồn tại tạm, không có schema chia sẻ với BE.
**Testing**: Jest — mở rộng `speaker-mapping.service.spec.ts` đã có (đúng cách `feat-speaker-tagging-live` đã làm cho GA-30/32/35), KHÔNG tạo file test service mới. FE — theo mức test coverage hiện có của repo (React Testing Library nếu cần, xem mục 5).
**Target Platform**: Trình duyệt Chrome/Edge trên PC trạm cố định trong phòng họp — `MediaRecorder` xuất `audio/webm;codecs=opus` mặc định (đã có sẵn trong `SUPPORTED_AUDIO_EXTENSIONS`). Cần HTTPS cho `getUserMedia` (RISK-003, spec.md mục 1.5 — xác nhận trước khi lắp đặt thật, ngoài phạm vi code).

**Constraints**:
- KHÔNG thêm bảng/cột (NFR-006 spec.md).
- KHÔNG sửa phần logic gộp/mâu thuẫn/group-by-label của `applySpeakerMappingsFromEvents()` đã verify ở GIAI ĐOẠN 2 (NFR-007) — method mới chỉ TẠO event, không đụng bước ÁP mapping.
- KHÔNG đụng module `recording` cho phần gán tên — route mới đặt trong module `transcription`, cùng lý do tránh phụ thuộc vòng mà `feat-speaker-tagging-live` đã chốt (spec.md mục 1.4 file đó).
- KHÔNG đổi endpoint `audio-upload` hiện có.
- KHÔNG tạo endpoint chunk-upload lên server (research.md D-2/D-3 đã loại bỏ hướng này).

**Scale/Scope**: BE — 1 DTO mới (2 class), 1 error code mới, 1 method mới (~60 dòng, theo sát `createSpeakerMappings`), 1 route mới. FE — 1 module ghi âm mới (MediaRecorder + IndexedDB + phục hồi), sửa trang họp để hiện nút theo `rooms.has_microphone`, UI gán tên trong lúc họp, gọi 2 API tuần tự sau khi dừng ghi.

## 3. Constitution Check

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Không thêm bảng/cột | ✅ PASS | |
| Không sửa `applySpeakerMappingsFromEvents()` phần logic đã có | ✅ PASS — GATE BẮT BUỘC | Chỉ thêm method tạo event mới, tái dùng anchor `post` có sẵn |
| Không đụng module `recording` | ✅ PASS — GATE BẮT BUỘC | Route mới trong `transcription`, giống GA-30/32/35 |
| Không seed permission mới | ⚠️ **CẦN XÁC NHẬN** | Đề xuất tái dùng `transcript.speaker_tag` — spec.md mục 1.5/2.2 đánh dấu CHƯA được Thiếu Chủ chốt trực tiếp. **Không tự ý seed migration permission mới cho tới khi xác nhận.** |
| Không dùng Prisma/đổi ORM | ✅ PASS | |
| Không thêm dependency FE mới không cần thiết | ✅ PASS | Dùng Web API gốc |

## 4. Vị trí chèn code cụ thể

### 4.1 BE — DTO mới

`src/modules/transcription/dto/create-offset-speaker-marks.dto.ts` (mới):

```ts
export class OffsetSpeakerMarkItemDto {
  @ApiProperty({ description: 'Giây tính từ lúc bắt đầu ghi (>= 0)' })
  @IsNumber()
  @Min(0)
  offsetSeconds: number;

  @ApiPropertyOptional({ description: 'Map tới user hệ thống (UUID)' })
  @IsOptional()
  @IsUUID()
  speakerUserId?: string;

  @ApiPropertyOptional({ description: 'Map tới khách ngoài công ty (UUID)' })
  @IsOptional()
  @IsUUID()
  externalParticipantId?: string;

  @ApiProperty({ description: 'Tên hiển thị' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName: string;
}

export class CreateOffsetSpeakerMarksDto {
  @ApiProperty({ type: [OffsetSpeakerMarkItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OffsetSpeakerMarkItemDto)
  marks: OffsetSpeakerMarkItemDto[];
}
```

Bám sát 100% style `SpeakerMappingItemDto`/`CreateSpeakerMappingsDto` đã có — chỉ đổi `speakerLabel: string` thành `offsetSeconds: number`.

### 4.2 BE — error code mới

`src/modules/transcription/constants/transcription-error-codes.ts` — thêm:

```ts
OFFSET_OUT_OF_RANGE: 'OFFSET_OUT_OF_RANGE',
```

`RECORDING_SESSION_NOT_FOUND` đã tồn tại sẵn — tái dùng cho trường hợp session không tồn tại/không thuộc meeting (không cần code mới).

### 4.3 BE — method mới trong `SpeakerMappingService`

```ts
/**
 * REC-006 (feat-fixed-station-browser-recording): nhận mốc gán tên kèm
 * offsetSeconds do FE tự tính (đồng hồ trình duyệt cục bộ trong lúc ghi tại
 * trạm cố định) — TÁI DÙNG anchor recording_sessions.started_at + tagSource
 * 'post' của GIAI ĐOẠN 2 (đã verify thật), KHÔNG cần marker recording_start_marker
 * của GIAI ĐOẠN 3 vì recording_sessions đã tồn tại ngay sau audio-upload.
 */
async createOffsetSpeakerMarks(
  meetingId: string,
  sessionId: string,
  dto: CreateOffsetSpeakerMarksDto,
  userId: string,
): Promise<{ savedCount: number }> {
  const session = await this.recordingSessionRepo.findOne({
    where: { id: sessionId },
  });
  if (!session || session.meetingId !== meetingId) {
    throw new NotFoundException({
      success: false,
      message: 'Recording session khong ton tai hoac khong thuoc cuoc hop nay.',
      error: {
        code: TRANSCRIPTION_ERROR_CODES.RECORDING_SESSION_NOT_FOUND,
        details: {},
      },
    });
  }

  await this.assertHostOrAdmin(meetingId, userId);

  // ERR-TAG-005 pattern — đúng-một-trong-hai, copy từ createSpeakerMappings (all-or-nothing).
  for (const item of dto.marks) {
    const hasUser = !!item.speakerUserId;
    const hasExternal = !!item.externalParticipantId;
    if (hasUser === hasExternal) {
      throw new BadRequestException({
        success: false,
        message: 'Moi mark phai co dung mot trong speakerUserId hoac externalParticipantId.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  // FR-015 (đã sửa all-or-nothing) — chỉ validate cận trên khi duration_seconds có giá trị
  // (có thể null nếu ffprobe lỗi lúc upload, xem mục 6 "Cần chốt").
  const outOfRange = dto.marks.filter((m) => {
    if (m.offsetSeconds < 0) return true;
    if (session.durationSeconds != null && m.offsetSeconds > session.durationSeconds) return true;
    return false;
  });
  if (outOfRange.length > 0) {
    throw new BadRequestException({
      success: false,
      message: 'Mot so offsetSeconds khong hop le (am hoac vuot qua do dai file).',
      error: {
        code: TRANSCRIPTION_ERROR_CODES.OFFSET_OUT_OF_RANGE,
        details: { count: outOfRange.length },
      },
    });
  }

  // Validate identity tồn tại thật — TÁI DÙNG nguyên đoạn batch findBy+In() của
  // createSpeakerMappings (dòng ~275-315 hiện tại), chỉ đổi nguồn dto.mappings -> dto.marks.
  // ... (giữ nguyên logic, không chép lại ở đây để tránh trôi khi code thật đổi)

  await this.dataSource.transaction(async (manager) => {
    for (const item of dto.marks) {
      const event = manager.create(MeetingEventEntity, {
        meetingId,
        eventType: MeetingEventType.SPEAKER_TAG,
        eventTime: new Date(session.startedAt.getTime() + item.offsetSeconds * 1000),
        actorUserId: userId,
        sourceType: MeetingEventSourceType.MANUAL,
        metadataJson: {
          recordingSessionId: sessionId,
          speakerUserId: item.speakerUserId ?? null,
          externalParticipantId: item.externalParticipantId ?? null,
          displayName: item.displayName,
          tagSource: 'post', // D-4 research.md — TÁI DÙNG anchor GIAI ĐOẠN 2, KHÔNG phải 'live'
        },
      });
      await manager.save(MeetingEventEntity, event);
    }
  });

  return { savedCount: dto.marks.length };
}
```

Điểm khác biệt so với `createLiveSpeakerTag` (GA-32): `recordingSessionId` KHÔNG null (session đã tồn tại thật lúc gọi — đúng bản chất trạm cố định, upload xảy ra trước khi gọi endpoint này), `tagSource='post'` KHÔNG phải `'live'` — nên `applySpeakerMappingsFromEvents()` xử lý các event này **giống hệt** cách nó đã xử lý mapping GA-21 (GIAI ĐOẠN 2) từ trước tới giờ, không cần nhánh code mới.

### 4.4 BE — Controller

Mở rộng `src/modules/transcription/live-speaker-tagging.controller.ts` (đã có, cùng base `@Controller('meetings/:meetingId')`) thay vì tạo controller riêng — cùng nhóm nghiệp vụ "gán danh tính người nói", cùng permission, tránh phân mảnh controller nhỏ lẻ.

```text
POST meetings/:meetingId/recording-sessions/:sessionId/speaker-marks
```

Route nằm dưới path `recording-sessions` (khác 3 route GA-30/32/35 dưới `recording/`) để phản ánh đúng ngữ nghĩa "gắn với một recording session cụ thể đã tồn tại" — khác marker/live-tag vốn không cần biết sessionId. NestJS controller path không bị ràng buộc phải khớp tên module chứa nó.

```ts
@Post('recording-sessions/:sessionId/speaker-marks')
@HttpCode(201)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('transcript.speaker_tag') // CHỜ XÁC NHẬN — mục 3 Constitution Check
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
async createOffsetSpeakerMarks(
  @Req() req: any,
  @Param('meetingId', ParseUUIDPipe) meetingId: string,
  @Param('sessionId', ParseUUIDPipe) sessionId: string,
  @Body() dto: CreateOffsetSpeakerMarksDto,
) {
  const userId = req.user?.userId || req.user?.sub || req.user?.id;
  const data = await this.speakerMappingService.createOffsetSpeakerMarks(meetingId, sessionId, dto, userId);
  return { success: true, message: 'Da ghi cac moc gan ten.', data };
}
```

### 4.5 FE — vị trí thêm code (đề xuất, plan mức module — chi tiết implementation để tasks.md/lúc code)

```text
FE_SmarTracking/src/service/transcriptionServices.js
  + createOffsetSpeakerMarks(meetingId, sessionId, marks)  // gọi POST speaker-marks

FE_SmarTracking/src/hooks/ hoặc src/utils/ (thư mục mới nếu cần)
  + useStationRecording.js (hoặc tương đương)  // MediaRecorder + IndexedDB + state ghi/mốc gán tên

FE_SmarTracking/src/components/recording/ (thư mục mới)
  + StationRecorder.jsx   // nút Bắt đầu/Dừng ghi + nút gán tên trong lúc họp, chỉ hiện khi room.hasMicrophone
```

Vị trí chính xác trong trang họp (nhúng `StationRecorder` ở đâu trong `InMeetingRoom.jsx` hay trang khác) — **để tasks.md quyết định sau khi xác nhận với Thiếu Chủ actor nào thấy nút này** (Host trên trạm, theo D-6 research.md).

## 5. Test Strategy

**BE**: mở rộng `speaker-mapping.service.spec.ts` đã có — KHÔNG tạo file mới (đúng cách `feat-speaker-tagging-live` đã làm):
- `createOffsetSpeakerMarks`: ghi đúng `event_time = startedAt + offsetSeconds`, `tagSource='post'`, `recordingSessionId` không null.
- Case session không tồn tại/khác meeting → 404 `RECORDING_SESSION_NOT_FOUND`.
- Case thiếu/thừa identity (đúng-1-trong-2) → 400, all-or-nothing (không ghi phần nào nếu 1 item sai).
- Case offset âm hoặc vượt `duration_seconds` → 400 `OFFSET_OUT_OF_RANGE`, all-or-nothing.
- Case `duration_seconds = null` (ffprobe lỗi lúc upload) → chỉ chặn offset âm, không chặn cận trên (xem mục 6 quyết định).
- Case identity không tồn tại (user/external) → 400, tái dùng đúng error code đã có.
- Case forbidden (không phải Host/Admin) → 403.
- **Integration**: sau khi ghi event, gọi `applySpeakerMappingsFromEvents()` (không sửa) trên transcript giả lập → xác nhận mapping áp đúng, publicerify KHÔNG regression với các test GIAI ĐOẠN 2 cũ (`tagSource='post'`) đã có.

**FE**: theo mức coverage hiện có của repo — ưu tiên test thủ công qua trình duyệt thật (ghi/dừng/upload/gán tên/phục hồi sau crash — RISK-001 bắt buộc smoke test tay, không phải unit test tự động) trước khi viết unit test cho phần logic thuần (tính offsetSeconds, thứ tự nối đoạn IndexedDB).

Không cần E2E DB chung mới — logic ghi event dùng lại đúng pipeline `applySpeakerMappingsFromEvents()` đã verify thật ở GIAI ĐOẠN 2 (T-TAG-010).

## 6. Cần chốt trước khi implement (phát sinh khi viết plan, chưa có trong spec.md)

| # | Vấn đề | Đề xuất | Vì sao chưa tự chốt |
|---|---|---|---|
| P-1 | `recording_sessions.duration_seconds` có thể `null` (ffprobe lỗi lúc `uploadAudioForTranscription`, `probeUploadedAudioDuration()` trả `null` best-effort) — validate cận trên FR-015 dựa vào field này | Khi `null`: chỉ chặn `offsetSeconds < 0`, KHÔNG chặn cận trên (best-effort, giống cách `finalizeFileToStopped`/`uploadAudioForTranscription` đã chấp nhận duration null ở nơi khác trong codebase) | Đây là edge case KHÔNG có trong spec.md gốc — cần Thiếu Chủ xác nhận hướng xử lý trước khi viết test case P-1 |
| P-2 | Permission endpoint mới | Tái dùng `transcript.speaker_tag` | Đã đánh dấu ở spec.md mục 1.5, nhắc lại vì đây là GATE trong Constitution Check — KHÔNG code route tới khi xác nhận |
| P-3 | Route path chính xác | `POST meetings/:meetingId/recording-sessions/:sessionId/speaker-marks`, đặt trong `live-speaker-tagging.controller.ts` | Đề xuất hợp lý theo convention hiện có, nhưng route path chưa từng được Thiếu Chủ duyệt trực tiếp — nêu rõ để duyệt cùng lúc với P-2 |

---

> Trạng thái: **CHỜ DUYỆT plan.md** (đặc biệt P-1/P-2/P-3). Sau khi duyệt, viết `tasks.md` rồi DỪNG — không code tới khi Thiếu Chủ đồng ý (theo yêu cầu).
