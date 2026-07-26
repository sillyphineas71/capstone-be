# Tasks: Cảnh báo xe không có quyền (ANPR-ALERT-001)



**Branch**: `017-unauthorized-vehicle-alert` | **Date**: 2026-07-25

**Spec**: spec.md | **Plan**: plan.md



---



## Phase 0: Setup & Foundation



### Mục tiêu

Kiểm tra và chuẩn bị môi trường, entities, migration cần thiết trước khi implement core logic.



### Tasks



- [x] T001 Kiểm tra migration hiện tại của security_alerts và alert_rules đã áp lên RDS chưa. Nếu chưa, tạo migration áp 2 bảng này theo entity đã có (`src/database/migrations/`).



- [x] T002 [P] Tạo migration seed permission `vehicle_alert.read` vào bảng permissions, gán cho role MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN (`src/database/migrations/`).



- [x] T003 [P] Tạo migration seed default alert_rules cho 3 alert_type: `vehicle_control_match`, `unknown_vehicle`, `vehicle_unauthorized` với enabled=true, channels=['in_app'] (`src/database/migrations/`).



---



## Phase 1: Core Logic — Extend evaluate() với Priority Chain



### Mục tiêu

Mở rộng VehicleControlAlertService.evaluate() để xử lý 4 tình huống (A, B, C, D) với priority chain (B>C>A>D).



### Dependencies

T001 (migration security_alerts + alert_rules phải xong trước)



### Tasks



- [x] T004 [P] Thêm enum notification_type `unknown_vehicle_alert`, `vehicle_unauthorized_alert` vào NotificationType trong `src/modules/notifications/entities/notification.entity.ts`.



- [x] T005 Mở rộng VehicleControlAlertService.evaluate() thêm tham số `eventId: string`; thêm 2 bước: (a) resolve zone_id từ channelId bằng cách query iot_devices.zone_id; (b) check vehicle_registrations cho unknown (A) và pending/rejected (D). Áp dụng priority chain: B>C>A>D. File: `src/modules/anpr/services/vehicle-control-alert.service.ts`.



- [x] T006 [P] [US1] Thêm DTO `ListUnknownVehiclesQueryDto` (nếu chưa có hoặc mở rộng) cho GET /api/v1/anpr/unknown-vehicles: page, limit, from, to, sortBy, sortOrder với validation class-validator. File: `src/modules/anpr/dto/list-unknown-vehicles-query.dto.ts`.



- [x] T007 [P] [US1] Thêm guard permission `vehicle_alert.read` vào controller endpoint GET /api/v1/anpr/unknown-vehicles. File: `src/modules/anpr/controllers/vehicle-webhook.controller.ts`.

- [x] T007b [P] [US1] Implement controller handler GET /api/v1/anpr/unknown-vehicles: gọi VehicleUnknownService.listUnknown() với query params (page, limit, from, to, sortBy, sortOrder), trả về response chuẩn (success, data, meta). File: `src/modules/anpr/controllers/vehicle-webhook.controller.ts`.



- [x] T008 [US1] Cập nhật VehicleResolveService.onVehicleEvent() để: (a) INSERT iot_device_events TRƯỚC; (b) lấy eventId; (c) gọi evaluate(plateNumber, context, eventId). File: `src/modules/anpr/services/vehicle-resolve.service.ts`.



---



## Phase 2: Alert Rules & Suppression



### Mục tiêu

Cập nhật cơ chế kiểm tra alert_rules cho cả 3 alert_type, đảm bảo FR-011.



### Dependencies

T005 (evaluate mở rộng phải xong)



### Tasks



- [x] T009 Cập nhật evaluate() để gọi `AlertRulesService.findEffectiveRule(alertType, zoneId)` cho từng alert_type (vehicle_control_match, unknown_vehicle, vehicle_unauthorized). Nếu không tìm thấy rule -> coi như enabled=true. File: `src/modules/anpr/services/vehicle-control-alert.service.ts`.



---



## Phase 3: Error Handling & Edge Cases



### Mục tiêu

Đảm bảo tất cả lỗi trong evaluate() đều NotThrow, không block event ingest.



### Dependencies

T005 (evaluate mở rộng phải xong)



### Tasks



- [x] T010 Đảm bảo mọi lỗi trong evaluate() được bọc trong try/catch riêng: (1) throttle check; (2) zone_id resolution; (3) vehicle_registrations query (ERR-006: DB error -> skip alert, không false positive); (4) recordAlert; (5) createNotification. File: `src/modules/anpr/services/vehicle-control-alert.service.ts`.



---



## Phase 4: Testing



### Mục tiêu

Unit tests và integration test cho all 10 ACs.



### Dependencies

T005, T008, T009, T010 (tất cả logic phải xong)



### Tasks



- [x] T011 Viết unit test cho VehicleControlAlertService.evaluate():

  - AC-001: Blocklist plate -> alert_type=vehicle_control_match, severity=high

  - AC-002: Watchlist plate -> alert_type=vehicle_control_match, severity=medium

  - AC-003: Unknown plate (no registration) -> alert_type=unknown_vehicle, severity=medium

  - AC-004: Pending registration -> alert_type=vehicle_unauthorized, severity=low

  - AC-005: Throttle -> cùng plate trong 5 phút -> bỏ qua

  - AC-008: alert_rules suppressed -> không alert, không notification

  - AC-009: No recipient -> log warning, không notification

  - AC-010: zone_id null -> vẫn ghi alert thành công

  - Priority chain: blocklist + active registration -> chỉ 1 alert blocklist

  - NotThrow: recordAlert fail -> không block; vehicle_registrations DB error -> bỏ qua alert

  File: `src/modules/anpr/services/vehicle-control-alert.service.spec.ts`



- [x] T012 Viết unit test cho VehicleResolveService.onVehicleEvent():

  - AC-006: DB error -> log error, vẫn persist iot_device_events, vẫn gửi notification

  - AC-007: createNotification fail -> log error, alert vẫn ghi

  - Test INSERT trước evaluate() -> source_event_id reference

  File: `src/modules/anpr/services/vehicle-resolve.service.spec.ts`



- [x] T013 Viết controller test cho:

  - 200: paginated list (page, limit, from, to)

  - 401: không có JWT token

  - 403: user không có permission vehicle_alert.read

  - 422: invalid params (invalid date format)

  **POST /api/v1/anpr/webhook/vehicle (validation failures):**
  - 400: ERR-001 plateNumber empty -> reject with validation error
  - 200: ERR-002 channelId missing -> xử lý với channelId=null, log warning, không reject
  File: `src/modules/anpr/controllers/vehicle-webhook.controller.spec.ts`



---



## Requirements Coverage



| FR / AC | Tên | Task liên quan | Phase |

|---|---|---|---|

| FR-001 | Priority chain B>C>A>D | T005, T011 | Phase 1 |

| FR-002 | Severity mapping | T005, T011 | Phase 1 |

| FR-003 | alert_type mapping | T004, T005 | Phase 1 |

| FR-004 | INSERT trước evaluate | T008 | Phase 1 |

| FR-005 | Blocklist alert | T005, T011 | Phase 1 |

| FR-006 | Watchlist alert | T005, T011 | Phase 1 |

| FR-007 | Unknown vehicle alert | T005, T011 | Phase 1 |

| FR-008 | Pending/rejected alert | T005, T011 | Phase 1 |

| FR-008b | source_event_id flow | T008 | Phase 1 |

| FR-009 | NotThrow toàn bộ evaluate | T010, T012 | Phase 3 |

| FR-010 | Throttle plateNumber 5 phút | T005, T010, T011 | Phase 1+3 |

| FR-011 | alert_rules check 3 alert_type | T003, T009, T011 | Phase 2 |

| FR-012 | No recipient fallback | T010, T011 | Phase 3 |

| FR-013 | recordAlert fail NotThrow | T010, T011 | Phase 3 |

| FR-014 | Throttle window skip | T005, T011 | Phase 1 |

| FR-015 | New alert after window | T005, T011 | Phase 1 |

| FR-016 | Auth check API | T007, T007b, T013 | Phase 1 |

| FR-017 | vehicle_alert.read check | T007, T007b, T013 | Phase 1 |

| FR-018 | Recipient roles | T005, T011 | Phase 1 |

| FR-019 | Zone_id gắn alert | T005, T011 | Phase 1 |

| FR-020 | zone_id resolve từ channelId | T005, T011 | Phase 1 |

| NFR-001 | Performance <500ms | T011 | Phase 4 |

| NFR-004 | Auth required | T007, T007b, T013 | Phase 1 |

| NFR-005 | vehicle_alert.read enforced | T007, T007b, T013 | Phase 1 |

| ERR-006 | DB error skip, không false positive | T010, T012 | Phase 3 |

| ERR-003 | 403 Forbidden | T007, T007b, T013 | Phase 1 |

| AC-001 | Blocklist flow | T005, T011 | Phase 1 |

| AC-002 | Watchlist flow | T005, T011 | Phase 1 |

| AC-003 | Unknown vehicle flow | T005, T011 | Phase 1 |

| AC-004 | Pending/rejected flow | T005, T011 | Phase 1 |

| AC-005 | Throttle | T005, T010, T011 | Phase 1+3 |

| AC-006 | NotThrow DB error | T010, T012 | Phase 3 |

| AC-007 | NotThrow notification error | T010, T012 | Phase 3 |

| AC-008 | Suppressed rule | T009, T011 | Phase 2 |

| AC-009 | No recipient | T010, T011 | Phase 3 |

| AC-010 | Zone ID null | T005, T011 | Phase 1 |