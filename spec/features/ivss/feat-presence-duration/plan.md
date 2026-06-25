# IPD-001 — plan.md (#41 duration + #42 timeline)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo plan IPD-001 sau spec DUYỆT (OQ-1…7 + C1–C3). IvssPresenceQueryService READ-ONLY: buildSession (dedup→interval→cluster→hở) → #41 duration + #42 timeline; 2 endpoint admin-gated. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ. **READ-ONLY thuần.**

## 0. Quyết định đã chốt (OQ + C)
OQ-1 cluster + **ưu tiên interval** (seen TRONG interval mở → bị nuốt; seen NGOÀI → cluster gap-threshold; 1 event KHÔNG vừa interval vừa cluster — chống double-count) · OQ-2 hợp lệ = enter/leave **xen kẽ**; rối → approx · OQ-3 hở đóng tại `min(endOrNow, lastActivity + gap)` · OQ-4 **2 endpoint** · OQ-5 `system_configs['ivss.presence.gap_threshold_seconds']` default 120, group 'ivss', bound **scheduled** (start/end) · OQ-6 chỉ `matched`; unmatched đếm riêng `unmatchedCount` · OQ-7 `presentRatio=duration/meeting-length` clamp ≤1.
- **C1** dedup `(event_time, direction, userId)` trước khi dựng segment. **C2** mọi output mang `method:'interval'|'approx'` (không trả durationMs trần). **C3** service chỉ SELECT (grep-proof gate).

## 1. IvssPresenceQueryService (READ-ONLY)
- Inject: `DataSource` (raw SELECT), config reader (gap-threshold qua `system_configs`, mirror `getChannelRoomMap` IPI-001).
- Public: `getUserPresence(meetingId, userId)` (#41+#42 chi tiết), `getMeetingPresence(meetingId)` (summary mọi participant).
- Core private: `buildSession(meetingId, userId, meetingBound)`, helpers `dedup`, `clusterSeen`, `closeOpenSegment`, `absentGaps`, `getGapThresholdSeconds`.

## 2. Đọc dữ liệu (SEC-03 bind)
- Meeting bound: `SELECT start_time, end_time, status FROM meetings WHERE id=$1` (scheduled bound OQ-5). Không có → 404 (controller).
- Events (matched): `SELECT event_time, payload_json->>'direction' AS direction, payload_json->>'similarity' AS similarity, payload_json->>'szUid' AS sz_uid FROM iot_device_events WHERE event_type='ivss_face_event' AND meeting_id=$1 AND payload_json->>'userId'=$2 AND payload_json->>'matchState'='matched' ORDER BY event_time ASC`.
- Unmatched count (OQ-6): `SELECT COUNT(*)::int AS n FROM iot_device_events WHERE event_type='ivss_face_event' AND meeting_id=$1 AND payload_json->>'userId'=$2 AND payload_json->>'matchState' <> 'matched'`. (userId có thể null trong unmatched_identity → count theo szUid? v1 đếm theo userId; ghi residual.)
- Participants (per-meeting): `SELECT mp.user_id, u.full_name FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=$1`.
- **KHÔNG select imageBase64** (IPI-001 không lưu). KHÔNG mutate.

## 3. Pseudo-code `buildSession` (chỗ dễ sai — REVIEW kỹ)
```
buildSession(events, bound{startTime,endTime,status}, gapSeconds):
  gapMs = gapSeconds * 1000
  ev = dedup(events, key=(event_time_iso, direction))      // C1 (userId đã cố định/đã lọc)
        .sortBy(event_time ASC)
  if ev.isEmpty:
    return { segments:[], durationMs:0, method:'approx', firstAt:null, lastAt:null }

  segments = []
  method = 'interval'                  // hạ xuống 'approx' khi có cluster / chuỗi rối
  openEnter = null                     // Date 'enter' chưa đóng
  clusterStart = null; clusterLast = null
  lastActivity = null                  // event_time gần nhất BẤT KỲ (kể cả seen bị nuốt) — cho OQ-3

  flushCluster():
    if clusterStart != null:
      segments.push({ start:clusterStart, end:clusterLast, source:'cluster' })
      method = 'approx'
      clusterStart = null; clusterLast = null

  for e in ev:
    t = e.event_time
    lastActivity = t                   // mọi event đều là bằng chứng có mặt
    switch e.direction:
      'enter':
        flushCluster()
        if openEnter != null:          // OQ-2 rối: 2 enter liên tiếp
          segments.push({ start:openEnter, end:t, source:'interval' }); method='approx'
        openEnter = t
      'leave':
        flushCluster()
        if openEnter != null:
          segments.push({ start:openEnter, end:max(t,openEnter), source:'interval' })
          openEnter = null
        else:                          // OQ-2 rối: leave-không-enter → bỏ qua
          method='approx'
      default ('seen' | lạ):
        if openEnter != null:
          continue                     // OQ-1: seen TRONG interval mở → bị nuốt (chỉ cập nhật lastActivity)
        else:
          if clusterStart == null: clusterStart=t; clusterLast=t
          elif (t - clusterLast) <= gapMs: clusterLast=t
          else: flushCluster(); clusterStart=t; clusterLast=t   // gap lớn → cluster mới

  flushCluster()
  if openEnter != null:                 // OQ-3 segment hở
    meetingEnded = (status != 'in_progress')   // hoặc now > endTime
    endOrNow = meetingEnded ? endTime : min(now(), endTime)
    closeAt = min(endOrNow, lastActivity + gapMs)     // chống tính dư khi mất 'leave'
    closeAt = max(closeAt, openEnter)
    segments.push({ start:openEnter, end:closeAt, source:'interval' })

  durationMs = Σ (s.end - s.start) for s in segments
  if segments.isEmpty AND ev.length >= 1:            // chỉ toàn 'leave' / rối hết → approx first→last
    durationMs = lastActivity - ev[0].event_time
    method = 'approx'
  return { segments, durationMs, method, firstAt:ev[0].event_time, lastAt:lastActivity }
```
- **Bất biến**: 1 event đóng góp tối đa 1 lần (seen trong interval bị nuốt; seen ngoài vào cluster) → KHÔNG double-count (OQ-1). durationMs ≥ 0 (mọi push đảm bảo end≥start).

## 4. #41 duration + #42 timeline + summary
- **#41** (`getUserPresence`): `{ userId, durationMs, method, segmentCount, presentRatio }`. `presentRatio = clamp(durationMs / (endTime-startTime), 0, 1)` (OQ-7).
- **#42** timeline: `segments:[{start,end,state:'present',source}]` + `absentGaps:[{start,end}]` (complement trong `[startTime,endTime]`) + `events:[{at,direction,similarity}]` (rawlog, SEC no-image) + `unmatchedCount`.
- **summary** (`getMeetingPresence`): participants → buildSession từng user → `[{ userId, fullName, durationMs, method, segmentCount, presentRatio, unmatchedCount }]`. **C2**: mỗi dòng có `method`.

## 5. Endpoints (OQ-4) — admin-gated
- `GET /api/v1/ivss/meetings/:meetingId/presence/:userId` → `{ duration:{durationMs,method,segmentCount,presentRatio}, timeline:{segments,absentGaps,events,unmatchedCount} }`.
- `GET /api/v1/ivss/meetings/:meetingId/presence` → summary array.
- `@Controller('ivss/meetings')`, `@UseGuards(JwtAuthGuard, MockPermissionsGuard)`, `@Permissions('ivss.presence.read')`, `ParseUUIDPipe` cho param, ValidationPipe per-route, envelope `{success,message,data}`. Meeting không tồn tại → 404. SEC-02.

## 6. gap-threshold reader (OQ-5)
`getGapThresholdSeconds(): Promise<number>` — `SELECT config_value FROM system_configs WHERE config_key='ivss.presence.gap_threshold_seconds' AND is_active=true LIMIT 1` → parseInt, hợp lệ (>0) dùng; else default 120. (Mirror precedence reader IPI-001/NoShow.)

## 7. File list
### Net-new
- `src/modules/ivss/services/ivss-presence-query.service.ts` (+ `.spec.ts`).
- `src/modules/ivss/controllers/ivss-presence.controller.ts` (+ `.spec.ts`).
### Modified
- `src/modules/ivss/ivss.module.ts` — provider `IvssPresenceQueryService` + controller `IvssPresenceController`.
> KHÔNG migration, KHÔNG env, KHÔNG đụng occupancy/no-show/face-access.

## 8. Test (mock DataSource feed chuỗi event — KHÔNG thiết bị)
- enter/leave sạch → 2 segment interval, duration=(t1-t0)+(t3-t2), method `interval`.
- chỉ-seen (gap≤th) → 1 cluster, method `approx`.
- chuỗi rối (enter,enter,leave / leave-không-enter) → KHÔNG vỡ, KHÔNG âm, method `approx`.
- hở (enter không leave): in_progress → close `min(now,end, lastActivity+gap)`; ended → `end_time` (clamp lastActivity+gap).
- gap > threshold giữa seen → 2 cluster.
- **C1 trùng**: feed event trùng `(event_time,direction)` → duration KHÔNG đổi.
- 0-event → duration 0, segments rỗng.
- unmatched bỏ (matchState≠matched không vào builder) + `unmatchedCount` đếm đúng.
- presentRatio clamp ≤ 1.
- **SEC**: eventLog KHÔNG ảnh; query chứa `event_type='ivss_face_event'` + bind `meeting_id`/`userId`.
- controller: 404 meeting không tồn tại; guard JwtAuthGuard wiring; **C2** summary mỗi dòng có method.
- Coverage **≥80%** `ivss-presence-query.service.ts`.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% query service; **C3 grep read-only**: `grep -iE 'INSERT|UPDATE|DELETE' ivss-presence-query.service.ts ivss-presence.controller.ts` → rỗng (chỉ SELECT); DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies). **KHÔNG live.**
- **Owed live**: số liệu interval/approx đúng chỉ rõ khi thiết bị thật — phụ thuộc **eventAction thật** (direction), **channel-map thật** (meeting_id resolve đúng), **nhịp event vs gap-threshold** (tune `system_configs`). Seed permission `ivss.presence.read`.

## 10. Kỷ luật
- **No-migration** (read-only). **SEC-02** admin-gated. **SEC-03** bind tham số mọi raw SQL. **SEC-01** KHÔNG trả imageBase64; eventLog metadata-only. **ARCH-01** READ-ONLY — KHÔNG đụng occupancy/no-show/early-vacancy/presence_snapshots; chỉ đọc `iot_device_events` lọc `event_type='ivss_face_event'`; KHÔNG NetSDK. **C3** KHÔNG mutate (grep-proof).
- Envelope `{success,message,data}`; ValidationPipe per-route.

> **STOP.** Plan + tasks chờ review trước khi code.
