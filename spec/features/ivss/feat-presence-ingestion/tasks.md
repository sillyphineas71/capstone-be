# IPI-001 — tasks.md (#38+#39 IVSS per-person presence ingestion)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo tasks IPI-001: T0 RECON-verify → T1 service (resolve+persist) → T2 channel-map + utc + direction → T3 provider swap → tests → T-GATE. Né migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. Né migration (iot_device_events).

## Thứ tự
T0 → T1 → T2 → T3 → T1b → T2b → T3b → T-GATE.

---

## T0 — Live verify (né-migration guard) — plan §0/§7
- Xác nhận lại (RECON): `iot_device_events` cột (`device_id NOT NULL, room_id/meeting_id/payload_json null, event_type/event_time/source_protocol/severity/processed_status NOT NULL`); `device_user_mappings.device_person_id` lưu szUid; `system_configs.config_json` jsonb; mọi SELECT iot_device_events hiện có lọc `event_type` (face_verify/face_stranger) — IVSS dùng `ivss_face_event` distinct.
- **AC**: dán xác nhận; nếu cột thiếu/buộc bảng mới → **DỪNG báo** (KHÔNG migration).

## T1 — IvssPresenceIngestionService: resolve + persist (code) — §2/§3/§7, OQ-1/5/7
- Impl `IvssEventHandlerPort.onFaceEvent`: resolveBridgeDeviceId (find) → resolveUser(szUid, source='ivss'+deleted_at) → resolveMeeting(best-effort) → persist `iot_device_events` (device=bridge, event_type='ivss_face_event', source_protocol='ivss', payload_json metadata-only KHÔNG ảnh). Matched (user&room) → processed; thiếu → `unmatched`/`direction='unknown'` (vẫn persist). **KHÔNG throw**.
- **AC**: known → INSERT processed + payload{userId,roomId,direction}; unknown szUid/channel → INSERT `unmatched` + `direction='unknown'`.

## T2 — channel-map + utc + direction (code) — §4/§5(utc)/§6, OQ-2/3, C3
- `getChannelRoomMap()` đọc `system_configs['ivss.channel_room_map']` config_json, validate uuid, thiếu→{}.
- `normalizeDirection(eventAction)`: biết→enter/leave; lạ/thiếu→`seen`.
- `parseUtc(raw)`: ISO + |skew|≤1h → eventTime; sai→now + `utcFallback:true`.
- **AC**: channel có map → roomId; lạ → unmatched; eventAction lạ → `seen`; utc rác → eventTime now + payload utcFallback.

## T3 — Provider swap (code, C2) — §5
- `ivss.module.ts`: thêm provider `IvssPresenceIngestionService`; `IVSS_EVENT_HANDLER` → `useExisting: IvssPresenceIngestionService`; giữ `DefaultIvssEventHandler` registered (không bind).
- **AC**: build resolve DI; webhook handoff vẫn gọi handler (qua port).

## T1b — resolve/persist test — OQ-1/5/7, SEC-01, C1
- known person+channel → persist processed + payload có userId/roomId; unknown szUid → unmatched; unknown channel → unmatched; bridge device không có → skip (no INSERT); DB lỗi → KHÔNG throw; **SEC** payload KHÔNG imageBase64; **C1** INSERT `event_type='ivss_face_event'` (≠ face_verify/face_stranger).
- **AC**: các ca xanh; ≥80% nhánh persist.

## T2b — channel-map/utc/direction test — OQ-2/3, C3
- map đọc + validate uuid (entry sai bị bỏ); direction enter/leave/seen; utc fallback.
- **AC**: các ca xanh.

## T3b — Provider swap regression test — C2
- `npx jest src/modules/ivss` (gồm webhook controller spec #36) xanh — 0 hồi quy. (Webhook mock handler port → swap không ảnh hưởng; DI-proof xác nhận bind đúng service.)
- **AC**: ivss suite xanh.

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% `ivss-presence-ingestion.service.ts`; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies). **KHÔNG live.**
- **Owed live (C1-runbook)**: channel→room map thật vào `system_configs`; eventAction thật (chốt enter/leave mapping); szUid round-trip (#37 device_person_id ↔ event szUid).
- **AC**: bảng gate + báo cáo: C1 isolation (event_type distinct, không patch) · resolve identity/location · unmatched lưu (OQ-5) · direction defensive (OQ-3) · utc fallback (C3) · provider swap 0 hồi quy (C2) · SEC no-image · coverage · DI-proof. STOP.

## Map task → scope
- T1/T1b → #39 persist per-identity event + resolve identity (OQ-1/5/7)
- T2/T2b → #38 location + direction (channel-map OQ-2, direction OQ-3, utc C3)
- T3/T3b → handler thật thay log-only (C2)
