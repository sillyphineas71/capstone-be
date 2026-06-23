# IPD-001 — tasks.md (#41 duration + #42 timeline)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo tasks IPD-001: T0 RECON-verify → T1 buildSession core → T2 duration/timeline/summary → T3 endpoints → T4 wiring → tests → T-GATE. READ-ONLY, no-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. READ-ONLY (no mutate, no migration).

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T-GATE.

---

## T0 — Live verify (read-only) — plan §2
- Xác nhận: `iot_device_events` đào jsonb `payload_json->>'userId'/'direction'/'matchState'/'similarity'/'szUid'` (IPI-001 flat); `meetings.start_time/end_time/status`; `meeting_participants.user_id`; `users.full_name`; `system_configs.config_value`. (Chỉ đọc; không cần cột mới.)
- **AC**: dán xác nhận; không cần migration → tiếp T1.

## T1 — buildSession core (code) — plan §3, OQ-1/2/3, C1
- `IvssPresenceQueryService.buildSession(events, bound, gapSeconds)`: dedup (event_time,direction) → sort → interval ưu tiên (enter/leave xen kẽ) → cluster seen ngoài interval (gap-threshold) → seen trong interval bị nuốt → segment hở đóng OQ-3 → trả `{segments, durationMs, method, firstAt, lastAt}`. Bất biến: 1 event tối đa 1 đóng góp; durationMs ≥ 0.
- `getGapThresholdSeconds()` đọc system_configs (default 120). SEC-03 bind.
- **AC**: enter/leave sạch → interval Σ đúng; seen-only → cluster approx; trùng (C1) → duration KHÔNG đổi.

## T1b — buildSession test — OQ-1/2/3, C1
- enter/leave sạch · chỉ-seen (gap≤th) · gap>th → 2 cluster · chuỗi rối (enter,enter,leave / leave-không-enter) không vỡ/không âm · hở in_progress→now-clamp / ended→end_time · hở lastActivity xa end>gap → đóng lastActivity+gap · trùng → bằng nhau · 0-event → 0.
- **AC**: ≥80% nhánh builder; method đúng mỗi ca.

## T2 — duration + timeline + summary (code) — plan §4, OQ-6/7, C2
- `getUserPresence(meetingId,userId)`: bound + events (matched) + unmatchedCount → buildSession → `{ duration:{durationMs,method,segmentCount,presentRatio}, timeline:{segments,absentGaps,events,unmatchedCount} }`. `presentRatio` clamp ≤1 (OQ-7). `absentGaps` = complement trong [start,end].
- `getMeetingPresence(meetingId)`: participants → buildSession từng user → summary `[{userId,fullName,durationMs,method,segmentCount,presentRatio,unmatchedCount}]` (C2 mỗi dòng method).
- eventLog metadata-only (SEC-01 no-image).
- **AC**: presentRatio clamp; unmatched đếm riêng (OQ-6); summary có method mỗi dòng (C2).

## T2b — duration/timeline/summary test — OQ-6/7, SEC-01
- presentRatio clamp ≤1; unmatched không vào duration nhưng unmatchedCount đúng; absentGaps đúng complement; eventLog KHÔNG ảnh.
- **AC**: các ca xanh.

## T3 — Endpoints (code) — plan §5, OQ-4, SEC-02
- `IvssPresenceController` `@Controller('ivss/meetings')`: `GET :meetingId/presence/:userId` + `GET :meetingId/presence`; `JwtAuthGuard+MockPermissionsGuard`, `@Permissions('ivss.presence.read')`, `ParseUUIDPipe`, ValidationPipe per-route, envelope `{success,message,data}`; meeting không tồn tại → 404.
- **AC**: per-user trả {duration,timeline}; per-meeting trả summary; 404 khi meeting không có; guard JwtAuthGuard wiring.

## T3b — Controller test — SEC-02, C2
- per-user envelope; per-meeting summary (method mỗi dòng); 404; guard metadata JwtAuthGuard.
- **AC**: các ca xanh.

## T4 — Wiring (code) — plan §7
- `ivss.module.ts`: provider `IvssPresenceQueryService` + controller `IvssPresenceController`.
- **AC**: build resolve DI; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies).

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% `ivss-presence-query.service.ts`; **C3 grep read-only** (INSERT/UPDATE/DELETE rỗng trong file mới); DI-proof. **KHÔNG live.**
- **Owed live**: số liệu interval/approx đúng chỉ rõ khi thiết bị thật — eventAction thật (direction) + channel-map thật (meeting_id) + nhịp event vs gap-threshold (tune system_configs). Seed permission `ivss.presence.read`.
- **AC**: bảng gate + báo cáo: buildSession (interval/cluster/hở/dedup C1) · method honesty (C2) · presentRatio (OQ-7) · unmatchedCount (OQ-6) · read-only grep-proof (C3) · coverage · DI-proof. STOP.

## Map task → scope
- T1/T1b → core session-builder (nền #41+#42)
- T2/T2b → #41 duration + #42 timeline + summary
- T3/T3b/T4 → endpoint admin-gated + wiring
