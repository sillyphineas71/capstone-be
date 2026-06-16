---
name: feat-no-show-cases-plan
description: Kế hoạch NSC-001 — NoShowService/DetectionService/Controller + internal token guard + cron wiring.
category: rooms
---

# Implementation Plan: No-show Cases (NSC-001)

- **Feature ID**: NSC-001 · **Module**: rooms (+ scheduler wiring) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo plan.md NSC-001 (NoShowController/Service/DetectionService, InternalTokenGuard, env token+threshold, cron wire). LOCK NC-1..6 + RP-1..5. | Toàn bộ file |

---

## 1. Technical Context (verified)
- scheduler.module import IotModule + SchedulerService có @Cron checkNoShow skeleton (gate SCHEDULER_NO_SHOW_CHECK_ENABLED default false) → wire detect().
- rooms.module (#30) có Auth/Jwt/Cache + entities; thêm WebsocketModule (cho WS) + NoShow providers; export NoShowDetectionService cho scheduler.
- system_configs: config_key/config_value. Internal token + threshold qua env (Joi). DataSource raw (SEC-03 bind). No migration.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `rooms/services/no-show.service.ts` (create + update) |
| Mới | `rooms/services/no-show-detection.service.ts` (detect) |
| Mới | `rooms/controllers/no-show.controller.ts` (POST internal + PATCH) |
| Mới | `rooms/guards/internal-token.guard.ts` (constant-time, fail-closed) |
| Mới | `rooms/dto/create-no-show.dto.ts`, `update-no-show.dto.ts` |
| Sửa | `rooms/rooms.module.ts` (+WebsocketModule, +providers/controller, export DetectionService) |
| Sửa | `config/env.validation.ts` (+NOSHOW_INTERNAL_TOKEN, +NO_SHOW_THRESHOLD_MINUTES) + .env.example + .env |
| Sửa | `scheduler/scheduler.module.ts` (+RoomsModule) + `scheduler.service.ts` (inject DetectionService, wire checkNoShow) |
| Mới (test) | no-show.service.spec, no-show-detection.service.spec, no-show.controller.spec |

## 3. InternalTokenGuard (NC-3, SEC-01)
```text
canActivate(ctx):
  expected = config.get('NOSHOW_INTERNAL_TOKEN','');
  if (!expected) → 401 (fail-closed, env unset).
  provided = req.headers['x-internal-token'];
  if (typeof provided != 'string' || !constantTimeEqual(provided, expected)) → 401.
  constantTimeEqual: Buffer length check trước; timingSafeEqual. KHÔNG log token.
```

## 4. NoShowService
```text
create({bookingId, meetingId, roomId, detectionStatus='risk', evidenceJson?}): {case, created}
  - INSERT INTO no_show_cases (booking_id,meeting_id,room_id,detection_status,evidence_json,detected_at)
    SELECT $1,$2,$3,$4,$5::jsonb, now()
    WHERE NOT EXISTS (SELECT 1 FROM no_show_cases WHERE booking_id=$1)
    RETURNING <cols>;   (parameterized; evidence_json KHÔNG token)
  - rows>0 → created=true → WS emit meeting.noshow.alert best-effort try/catch → return.
  - rows==0 → SELECT case theo booking_id LIMIT 1 → created=false (idempotent, 200).
update(id, dto, userId): full case
  - SELECT case; null → 404 NO_SHOW_CASE_NOT_FOUND.
  - terminal (detection_status ∈ {resolved,dismissed,released}) → 400 INVALID_NO_SHOW_TRANSITION (no re-open).
  - dto.detectionStatus: {warning_sent,released} → 400 INVALID_NO_SHOW_TRANSITION; ngoài {confirmed,dismissed,resolved} → 400 INVALID_DETECTION_STATUS.
  - UPDATE detection_status/resolution_status/note (COALESCE giữ cũ); resolved_by=userId nếu resolutionStatus set || target ∈ {dismissed,resolved}. RETURNING * → map full.
```

## 5. NoShowDetectionService.detect() (NC-2, RP)
```text
detect(): {scanned, created}
  - threshold = readThreshold(): system_configs[no_show.threshold_minutes] → env NO_SHOW_THRESHOLD_MINUTES → 15 (1 lần/đợt).
  - candidates = query (bind $1=threshold):
      SELECT b.id booking_id, b.meeting_id, b.room_id
      FROM room_bookings b LEFT JOIN room_booking_usages u ON u.booking_id=b.id
      WHERE b.status IN ('approved','active')
        AND b.reserved_start_time + ($1 * interval '1 minute') < now()
        AND u.first_presence_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM no_show_cases nc WHERE nc.booking_id=b.id);
  - for each: try { create({...,'risk', evidenceJson:{threshold, detectedAt}}) ; if created created++ } catch {log+continue}.
  - return {scanned, created}.  detect() KHÔNG throw ra ngoài.
```

## 6. Controller
```text
@Controller():
@Post('internal/no-show-cases') @HttpCode(? — 201/200 động) @UseGuards(InternalTokenGuard) @UsePipes(ValidationPipe) create(@Body CreateNoShowDto, @Res passthrough? ) :
  - service.create → created ? 201 : 200 (set status động qua @Res passthrough hoặc trả + HttpException? → dùng @Res({passthrough:true}) set status).
@Patch('no-show-cases/:id') @HttpCode(200) JWT+MockPerm @Permissions('room.noshow.update') @UsePipes(ValidationPipe) update(@Param uuid, @Body UpdateNoShowDto, @Req) → envelope.
```
- create dynamic status: dùng `@Res({ passthrough: true }) res` + `res.status(created?201:200)`; trả envelope.

## 7. DTO
```text
CreateNoShowDto { bookingId/meetingId/roomId @IsUUID; detectionStatus? @IsOptional @IsIn(['risk','confirmed']); evidenceJson? @IsOptional @IsObject }  (NC-6: IsIn risk/confirmed → khác → 400 VALIDATION_ERROR; service cũng chặn).
UpdateNoShowDto { detectionStatus? @IsOptional @IsString; resolutionStatus? @IsOptional @IsIn(['kept','false_positive','manual_override']); note? @IsOptional @IsString @MaxLength }
  (detectionStatus KHÔNG IsIn hẹp → để service phân biệt INVALID_NO_SHOW_TRANSITION vs INVALID_DETECTION_STATUS.)
```

## 8. Module + scheduler wiring
- rooms.module: +WebsocketModule; controllers +NoShowController; providers +NoShowService +NoShowDetectionService; exports +NoShowDetectionService.
- scheduler.module: imports +RoomsModule. scheduler.service: inject NoShowDetectionService; checkNoShow → try{ detect() }catch{log} (gate giữ default OFF).

## 9. ENV
Joi: `NOSHOW_INTERNAL_TOKEN: Joi.string().allow('').default('')` (fail-closed nếu rỗng), `NO_SHOW_THRESHOLD_MINUTES: Joi.number().integer().min(1).default(15)`. .env.example + .env.

## 10. Tests (mock dataSource + scheduler, ≥80%)
- no-show.service: create insert→201+emit / existing→200 no-emit / WS lỗi→vẫn trả; update valid / illegal(released)→400 / terminal→400 / 404.
- detection.service: threshold config>env>default; candidate query (bind threshold + LEFT JOIN + NOT EXISTS) → create gọi; isolation create-throw→continue.
- controller: internal create token ok→201/200, token sai/thiếu→401; update passthrough/404.
- (scheduler wire: gate OFF→detect không gọi — test ở scheduler.service nếu khả thi, hoặc note.)

## 11. DoD
```
[ ] InternalTokenGuard constant-time fail-closed (no log token)
[ ] NoShowService create atomic dedup + WS best-effort; update transitions + terminal + 404
[ ] DetectionService threshold precedence + candidate LEFT JOIN bind + isolation; detect không throw
[ ] Controller 2 route (201/200 động); cron wire gate OFF
[ ] env token+threshold; module+scheduler wiring; tests ≥80%; build/lint/jest/boot xanh; KHÔNG migration
```

> Trạng thái: CHỜ REVIEW sau implement (STOP code-review gate). Chưa commit.
