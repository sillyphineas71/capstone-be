# Quickstart: Cảnh báo xe không có quyền

## Test Scenarios

### 1. Blocklist vehicle enters gate
- Setup: vehicle_control_list with plate 30A12345, list_type=blocklist, active=true
- Trigger: IVSS sends vehicle event for 30A12345
- Verify: security_alert created with alert_type=vehicle_control_match, severity=high
- Verify: In-app notification sent to MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN
- Verify: source_event_id links to iot_device_events.id

### 2. Watchlist vehicle enters gate
- Setup: vehicle_control_list with plate 51B67890, list_type=watchlist, active=true
- Trigger: IVSS sends vehicle event for 51B67890
- Verify: security_alert with alert_type=vehicle_control_match, severity=medium

### 3. Unknown vehicle (no registration)
- Setup: plate NOT in vehicle_registrations, NOT in vehicle_control_list
- Trigger: IVSS sends vehicle event
- Verify: security_alert with alert_type=unknown_vehicle, severity=medium

### 4. Pending registration vehicle
- Setup: plate in vehicle_registrations with status=pending
- Trigger: IVSS sends vehicle event
- Verify: security_alert with alert_type=vehicle_unauthorized, severity=low

### 5. Throttle - same plate within 5 minutes
- Trigger: Same plate appears again within 5 minutes
- Verify: NO new alert, NO new notification

### 6. Priority chain - blocklist wins
- Setup: plate in BOTH control_list (blocklist) AND registrations (active)
- Verify: Only 1 alert, alert_type=vehicle_control_match (blocklist wins)

### 7. Alert rules suppressed
- Setup: alert_rules for vehicle_control_match with enabled=false
- Verify: NO alert, NO notification

### 8. DB error - NotThrow
- Scenario: recordAlert fails
- Verify: event ingested OK, notification still sent

## Verification Checklist
- [ ] Priority chain: blocklist > watchlist > unknown > pending/rejected
- [ ] Throttle key = plateNumber only
- [ ] zone_id resolved from channelId
- [ ] zone_id=null when resolution fails (not block)
- [ ] evaluate() NotThrow
- [ ] Permission vehicle_alert.read enforced
