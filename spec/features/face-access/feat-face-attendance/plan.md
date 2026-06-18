# FAT-001 — PLAN

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Tạo plan FAT-001 — hook port ở common, FaceAttendanceService, chèn hook vào iot verify. | Toàn bộ |

## Kiến trúc (NC-4 no-cycle)
```
iot.receiveVerifyEvent()  ──(after commit)──>  @Optional @Inject(FACE_VERIFY_HOOK)
        │                                                │
        └── try/catch (nuốt lỗi, giữ 200)                ▼
                                            common/ports/face-verify-hook.ts
                                            (interface FaceVerifyHook + token)
                                                         ▲ useExisting
                                            face-access (@Global)
                                            FaceAttendanceService implements FaceVerifyHook
                                                         │ raw SQL (DataSource)
                                            device_user_mappings → meetings
                                            → attendance_records + attendance_events
```
- Token đặt ở `common` (leaf, không import module nào) → cả `iot` lẫn `face-access` import an toàn, không vòng.
- `face-access` `@Global()` (như `StorageModule`) → `iot` inject token mà không cần `imports: [FaceAccessModule]`.

## Files
| File | Hành động |
| :--- | :--- |
| `src/common/ports/face-verify-hook.ts` | NEW — `FaceVerifyHook`, `FaceVerifyInput`, `FACE_VERIFY_HOOK` token |
| `src/modules/face-access/services/face-attendance.service.ts` | NEW — `FaceAttendanceService` (onVerify/resolve/upsert) |
| `src/modules/face-access/face-access.module.ts` | EDIT — `@Global()`, +provider `{provide: FACE_VERIFY_HOOK, useExisting: FaceAttendanceService}`, +export |
| `src/modules/iot/services/iot-devices.service.ts` | EDIT — `@Optional() @Inject(FACE_VERIFY_HOOK)`; gọi hook sau commit trong try/catch |
| `src/config/env.validation.ts` | EDIT — +`ATTENDANCE_LATE_GRACE_MINUTES` (Joi scoped) |
| `.env.example` | EDIT — +`ATTENDANCE_LATE_GRACE_MINUTES=0` |
| `src/modules/face-access/services/face-attendance.service.spec.ts` | NEW — test ≥80% branch |

## onVerify(input) flow
1. `resolveMapping(deviceId, personId, personName)` → `{userId, meetingId}` | null. Primary: `device_id + device_person_id=personId`; fallback `device_person_code=personName`. `meetingId = metadata_json.bookingId`. Thiếu → null.
2. null → `logger.warn` unmatched, return.
3. `SELECT id, start_time FROM meetings WHERE id=$1`. Không có → warn no-meeting, return.
4. grace = `getLateGraceMinutes()` (env, default 0). `isLate = verifyTime > start + grace`; `lateMinutes = isLate ? max(0, round((verify-start)/60000)) : 0`.
5. `SELECT id FROM attendance_records WHERE meeting_id=$1 AND user_id=$2 LIMIT 1`.
   - none → INSERT (RETURNING id), `eventType='check_in'`.
   - exists → UPDATE `last_detected_at=verify` WHERE id, `eventType='face_detected'`.
6. INSERT `attendance_events` (meeting_id, attendance_record_id, user_id, room_id, device_id, event_type, event_time, source_type=camera).

## Quyết định
- anomaly KHÔNG ghi attendance_events (meeting_id NOT NULL+FK) — chỉ log; raw đã ở iot_device_events (spec §2.3).
- check_in_method=door_camera, attendance_source=camera, source_type=camera.
- KHÔNG migration, parameterized, `.js` import.
