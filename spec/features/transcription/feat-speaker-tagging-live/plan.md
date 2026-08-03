## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo plan.md ban đầu, đối chiếu spec.md với code thật của `SpeakerMappingService` (đã implement ở GIAI ĐOẠN 2). | Toàn bộ file (mới) |

# Implementation Plan: TRANS-SPEAKER-TAG-LIVE-001 Speaker Tagging — Live

**Branch**: `feat-speaker-tagging-live` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)
**Input**: `spec/features/transcription/feat-speaker-tagging-live/spec.md`
**Nguồn quyết định gốc**: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` GIAI ĐOẠN 3

> **Đây là bước documentation-first. Không có code nào được viết trong phạm vi plan.md này.**

## 1. Feature Summary

Thêm 3 endpoint mới (marker, live-tag, manual-correction) và mở rộng `SpeakerMappingService.applySpeakerMappingsFromEvents()` (đã có từ GIAI ĐOẠN 2) để xử lý thêm nguồn sự kiện `tagSource='live'` với anchor riêng (`recording_start_marker`) thay vì `recording_sessions.started_at`. Toàn bộ nằm trong module `transcription`, không đụng `recording`.

## 2. Technical Context

**Language/Version**: TypeScript/NestJS, không đổi.
**Primary Dependencies**: Không thêm — dùng lại toàn bộ hạ tầng `SpeakerMappingService`/`TranscriptEntity`/`MeetingEventEntity`/`RecordingSessionEntity` đã inject sẵn.
**Storage**: PostgreSQL, KHÔNG DDL — chỉ thêm 1 giá trị enum TypeScript mới (`MeetingEventType.RECORDING_START_MARKER`) + 1 migration tài liệu hoá (no-op, giống mẫu `20260617`/`20260802000001`).
**Testing**: Jest — mở rộng `speaker-mapping.service.spec.ts` đã có, KHÔNG cần integration test mới riêng (đã có T-TAG-010 verify pipeline chung; feature này chỉ cần verify phần MỞ RỘNG — có thể thêm 1 case mới vào chính spec file cũ, xem mục 5).
**Target Platform**: Không đổi.
**Constraints**:
- KHÔNG thêm bảng/cột.
- KHÔNG sửa module `recording` (spec.md mục 4.3, OOS-002).
- KHÔNG viết lại logic gộp/mâu thuẫn/apply đã có — chỉ mở rộng nguồn input.
- Dùng lại permission `transcript.speaker_tag`, không seed mới.

**Scale/Scope**: 1 giá trị enum mới, 1 migration tài liệu hoá, 3 method mới trong `SpeakerMappingService`, 1 controller mới nhỏ (3 route), sửa 1 method có sẵn (`applySpeakerMappingsFromEvents`).

## 3. Constitution Check

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Không thêm bảng/cột | ✅ PASS | |
| Không thêm permission mới | ✅ PASS | Tái sử dụng `transcript.speaker_tag` |
| Không sửa module `recording` | ✅ PASS — GATE BẮT BUỘC | Xem spec.md mục 4.3 lý do (tránh phụ thuộc vòng module) |
| Không viết lại logic đã có | ✅ PASS — GATE BẮT BUỘC | Chỉ mở rộng, không refactor `applyResolvedMappingsToTranscript` |
| Không dùng Prisma/đổi ORM | ✅ PASS | |

## 4. Vị trí chèn code cụ thể

### 4.1 `meeting-event.entity.ts` — enum mới

```ts
export enum MeetingEventType {
  // ... đã có, kể cả SPEAKER_TAG từ GIAI ĐOẠN 2 ...
  RECORDING_START_MARKER = 'recording_start_marker', // MỚI — feat-speaker-tagging-live
}
```

### 4.2 `speaker-mapping.service.ts` — 3 method mới + sửa `applySpeakerMappingsFromEvents`

```ts
async createStartMarker(meetingId: string, userId: string): Promise<{ eventTime: Date }> {
  await this.assertHostOrAdmin(meetingId, userId);   // TÁI SỬ DỤNG helper đã có
  const event = this.meetingEventRepo.create({
    meetingId,
    eventType: MeetingEventType.RECORDING_START_MARKER,
    eventTime: new Date(),                            // server đóng dấu — quyết định #7
    actorUserId: userId,
    sourceType: MeetingEventSourceType.MANUAL,
    metadataJson: { source: 'live_tap' },
  });
  const saved = await this.meetingEventRepo.save(event);
  return { eventTime: saved.eventTime };
}

async createLiveSpeakerTag(
  meetingId: string,
  dto: CreateLiveSpeakerTagDto,   // { speakerUserId?, externalParticipantId?, displayName }
  userId: string,
): Promise<{ eventTime: Date }> {
  await this.assertHostOrAdmin(meetingId, userId);
  // Validate đúng-một-trong-hai — TÁI SỬ DỤNG pattern ERR-TAG-005 (copy 4 dòng, không
  // đáng tách hàm dùng chung vì DTO khác shape — createSpeakerMappings validate CẢ
  // MẢNG, còn đây chỉ 1 item).
  ...
  const event = this.meetingEventRepo.create({
    meetingId,
    eventType: MeetingEventType.SPEAKER_TAG,           // CÙNG loại event GIAI ĐOẠN 2 dùng
    eventTime: new Date(),
    actorUserId: userId,
    sourceType: MeetingEventSourceType.MANUAL,
    metadataJson: {
      recordingSessionId: null,                        // CHƯA có session — khác GA-21
      speakerUserId: dto.speakerUserId ?? null,
      externalParticipantId: dto.externalParticipantId ?? null,
      displayName: dto.displayName,
      tagSource: 'live',
    },
  });
  const saved = await this.meetingEventRepo.save(event);
  return { eventTime: saved.eventTime };
}

async setManualRecordingStart(
  meetingId: string,
  dto: SetManualRecordingStartDto,   // { startedAt: string (ISO) }
  userId: string,
): Promise<{ eventTime: Date }> {
  await this.assertHostOrAdmin(meetingId, userId);
  const meeting = await this.meetingRepo.findOne({ where: { id: meetingId } });  // MỚI — cần inject MeetingEntity repo
  if (!meeting) throw new NotFoundException(...);

  const requested = new Date(dto.startedAt);
  const now = new Date();
  if (requested.getTime() > now.getTime()) {
    throw new BadRequestException(...);  // ERR-LIVE-002
  }
  const anchor = meeting.actualStartTime ?? meeting.startTime;
  const boundMs = 24 * 60 * 60 * 1000;  // ±24h — xem mục 6 lý do chọn số này
  if (Math.abs(requested.getTime() - anchor.getTime()) > boundMs) {
    throw new BadRequestException(...);  // ERR-LIVE-003
  }

  const event = this.meetingEventRepo.create({
    meetingId,
    eventType: MeetingEventType.RECORDING_START_MARKER,
    eventTime: requested,               // NGOẠI LỆ DUY NHẤT: client-supplied time, đã validate
    actorUserId: userId,
    sourceType: MeetingEventSourceType.MANUAL,
    metadataJson: { source: 'manual_entry' },
  });
  const saved = await this.meetingEventRepo.save(event);
  return { eventTime: saved.eventTime };
}
```

`applySpeakerMappingsFromEvents()` (đã có) — sửa đoạn tính `offsetMs` per-event để chọn đúng anchor theo `tagSource`:

```ts
// Đọc marker MỚI NHẤT của meeting (nếu có) — 1 query thêm, chỉ chạy khi có event live.
const latestMarker = await this.meetingEventRepo.findOne({
  where: { meetingId: transcript.meetingId, eventType: MeetingEventType.RECORDING_START_MARKER },
  order: { eventTime: 'DESC' },
});

for (const event of relevantEvents) {
  const meta = event.metadataJson as Record<string, unknown>;
  const tagSource = meta['tagSource'];
  let anchorMs: number;
  if (tagSource === 'live') {
    if (!latestMarker) continue;   // FR-007/ERR-LIVE-004 — không đoán
    anchorMs = latestMarker.eventTime.getTime();
  } else {
    anchorMs = startedAtMs;        // post — giữ nguyên logic GIAI ĐOẠN 2
  }
  const offsetMs = event.eventTime.getTime() - anchorMs;
  // ... phần còn lại GIỮ NGUYÊN 100% (tìm segment, gộp/mâu thuẫn) ...
}
```

Đồng thời sửa câu query `relevantEvents` — GIAI ĐOẠN 2 lọc `metadataJson.recordingSessionId === transcript.recordingSessionId`; giờ PHẢI thêm nhánh: chấp nhận event có `metadataJson.recordingSessionId === null && metadataJson.tagSource === 'live'` (đã lọc theo `meetingId = transcript.meetingId` từ trước ở bước query, nên an toàn — CLR-002 spec.md đã ghi rõ giới hạn giả định 1 meeting = 1 session).

### 4.3 Cần inject thêm `MeetingEntity` repo vào `SpeakerMappingService`

`MeetingEntity` chưa được inject trong `SpeakerMappingService` (GIAI ĐOẠN 2 không cần đọc bảng `meetings`, chỉ `meeting_participants`). Cần thêm `@InjectRepository(MeetingEntity)` vào constructor — **không cần sửa `imports:` của `TranscriptionModule`** vì `MeetingEntity` đã được `MeetingsModule` export qua `TypeOrmModule` (đã import sẵn), giống cách các entity khác đã inject được ở GIAI ĐOẠN 2 (xem `feat-speaker-tagging-post-meeting/plan.md` mục 5.4).

### 4.4 Controller mới

```text
src/modules/transcription/live-speaker-tagging.controller.ts   (mới, base @Controller('meetings/:meetingId'), giống TranscriptionController)
src/modules/transcription/dto/create-live-speaker-tag.dto.ts   (mới)
src/modules/transcription/dto/set-manual-recording-start.dto.ts (mới)
```

Route đề xuất (theo GA-30/32/35 đặt tên trong plan tổng):

```text
POST meetings/:meetingId/recording/start-marker
POST meetings/:meetingId/recording/live-speaker-tag
POST meetings/:meetingId/recording/start-marker/manual
```

## 5. Test Strategy

Không tạo file test mới riêng — **mở rộng `speaker-mapping.service.spec.ts` đã có** (đúng nguyên tắc "không phân mảnh test" khi logic chỉ là mở rộng của service đã test kỹ):

- `createStartMarker`: ghi đúng event_type, event_time=server-now, authz.
- `createLiveSpeakerTag`: ghi đúng metadata (recordingSessionId=null, tagSource=live), validate đúng-1-trong-2 identity, authz.
- `setManualRecordingStart`: ERR-LIVE-002 (tương lai), ERR-LIVE-003 (quá xa), happy path.
- `applySpeakerMappingsFromEvents` — case MỞ RỘNG: 1 event live + có marker → áp đúng; 1 event live + KHÔNG có marker → bỏ qua (FR-007); event live + event post CÙNG trỏ 1 identity ở 2 speakerLabel khác nhau → gộp đúng (AC-006, xuyên nguồn).

Không cần integration E2E mới trên DB chung — T-TAG-010 (GIAI ĐOẠN 2) đã verify thật cơ chế `applySpeakerMappingsFromEvents` hoạt động đúng; feature này chỉ mở rộng logic CHỌN ANCHOR, verify bằng unit test là đủ tin cậy (không có phần nào phụ thuộc hạ tầng ngoài — không MinIO, không BullMQ, không Python worker).

## 6. Ghi chú số liệu — ngưỡng ±24h (ERR-LIVE-003)

Không có căn cứ đo đạc nào trong plan tổng cho con số cụ thể — đây là **giá trị đề xuất hợp lý** (đủ rộng để cho phép Host sửa vào sáng hôm sau nếu quên tối qua, đủ hẹp để bắt lỗi nhập sai ngày/tháng hoàn toàn). Cần Thiếu Chủ xác nhận hoặc điều chỉnh khi review plan này — không phải con số đã chốt cứng.
