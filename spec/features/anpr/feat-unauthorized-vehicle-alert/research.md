# Research: Cảnh báo xe không có quyền (ANPR-ALERT-001)

## Codebase Analysis

### Existing Code
- src/modules/anpr/services/vehicle-control-alert.service.ts — VehicleControlAlertService.evaluate() đã implement đối chiếu vehicle_control_list (blocklist/watchlist) với NotThrow, throttle 5 phút, alert_rules check, recordAlert + createNotification.
- src/modules/anpr/services/vehicle-resolve.service.ts — VehicleResolveService.onVehicleEvent() gọi evaluate() sau khi persist event vào iot_device_events. Hiện tại zone_id hardcode null.
- src/modules/anpr/services/vehicle-unknown.service.ts — VehicleUnknownService đọc danh sách xe lạ từ iot_device_events (unmatched), không gọi từ evaluate().
- src/modules/alerts/services/alerts.service.ts — AlertsService.recordAlert() dùng để ghi security_alerts.
- src/modules/alerts/services/alert-rules.service.ts — AlertRulesService.findEffectiveRule() kiểm tra rule có suppressed không.
- src/modules/notifications/notifications.service.ts — createNotification() gửi in-app notification.

### Gaps cần implement
1. evaluate() chưa xử lý tình huống (A) unknown_vehicle và (D) vehicle_unauthorized (pending/rejected)
2. zone_id đang hardcode null, cần resolve từ channelId (iot_devices.zone_id)
3. Priority chain (B>C>A>D) chưa implement — hiện tại chỉ check control-list rồi return
4. Throttle chưa áp dụng cho unknown_vehicle và vehicle_unauthorized
5. alert_rules chỉ check 'vehicle_control_match' — cần thêm 'unknown_vehicle', 'vehicle_unauthorized'
6. Permission vehicle_alert.read chưa được seed
7. SecurityAlertEntity và AlertRuleEntity đã có entity nhưng chưa áp migration RDS

## Technology Decisions

| Decision | Choice | Rationale |
|---|------|------|
| Framework | NestJS + TypeORM | Project convention |
| DB | PostgreSQL | Project convention |
| Alert persistence | security_alerts table | Entity đã có |
| Notification | IN-APP only | Spec yêu cầu, không email/WebSocket |
| Throttle | In-memory Map<string, number> | Pattern mirror StrangerAlertService |
| Zone resolution | Query iot_devices.zone_id qua channelId | FR-020 |
| Permission | vehicle_alert.read | Tách biệt khỏi vehicle_control.read (UC-113) |
| Dedup | Throttle in-memory, không DB unique constraint | FR-010, DM-02 clarification |

## Dependencies
- UC-90-94 Zone Model — zone_id thực tế
- UC-112 Ghi nhận sự kiện biển số — webhook ANPR trigger
- UC-113 Danh sách kiểm soát phương tiện — vehicle_control_list data
- Alerts module — security_alerts, alert_rules entities + services
- Notifications module — in-app notification service

## Risks
- Throttle in-memory reset khi restart — known limitation, chấp nhận cho capstone
- zone_id có thể null nếu UC-90-94 chưa hoàn thiện — fallback null không block alert
- permission vehicle_alert.read cần migration seed riêng
