# Data Model: Cảnh báo xe không có quyền (ANPR-ALERT-001)

## Entities

### 1. vehicle_control_list (existing)
| Field | Type | Purpose |
|---|---|---|
| id | uuid PK | |
| plate_number | varchar(16) NOT NULL | Biển số đã normalize |
| plate_raw | varchar(20) nullable | Biển số gốc |
| list_type | varchar(20) | 'blocklist' | 'watchlist' |
| reason | varchar(255) nullable | Lý do |
| active | boolean default true | |
| deleted_at | timestamptz nullable | Soft-delete |

Index: UNIQUE(plate_number, list_type) WHERE deleted_at IS NULL

### 2. vehicle_registrations (existing)
| Field | Type | Purpose |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK -> users | |
| plate_number | varchar(16) NOT NULL | Biển số đã normalize |
| plate_raw | varchar(20) | Biển số gốc |
| status | varchar(30) | 'active' | 'pending' | 'rejected' | 'inactive' |
| deleted_at | timestamptz nullable | Soft-delete |

### 3. security_alerts (existing — cần migration áp RDS)
| Field | Type | Purpose |
|---|---|---|
| id | uuid PK | |
| alert_type | varchar(40) | 'vehicle_control_match' | 'unknown_vehicle' | 'vehicle_unauthorized' |
| severity | varchar(20) | 'high' | 'medium' | 'low' |
| zone_id | uuid nullable FK -> zones | |
| status | varchar(30) default 'new' | 'new' | 'acknowledged' | 'resolved' |
| triggered_at | timestamptz | |
| last_seen_at | timestamptz nullable | |
| occurrence_count | int default 1 | |
| source_event_id | uuid nullable FK -> iot_device_events | |
| rule_id | uuid nullable FK -> alert_rules | |
| payload_json | jsonb | { plateNumber, listType, reason, channelId, direction, controlListEntryId } |
| acknowledged_by | uuid nullable | |
| resolved_by | uuid nullable | |

Constraints: KHÔNG soft-delete, append-only, KHÔNG DB unique constraint (dedup = throttle in-memory)

### 4. alert_rules (existing — cần migration áp RDS)
| Field | Type | Purpose |
|---|---|---|
| id | uuid PK | |
| alert_type | varchar(40) | |
| enabled | boolean | |
| channels | jsonb | ['in_app'] |
| zone_id | uuid nullable | |

### 5. iot_device_events (existing)
event_type = 'ivss_vehicle_event'
payload_json chứa: plateNumber, plateRaw, userId, channelId, direction, matchState

### 6. notifications (existing)
notification_type = 'vehicle_control_list_match' | 'unknown_vehicle_alert' | 'vehicle_unauthorized_alert'
channel = 'in_app'

### 7. zones (existing)
zone_type = 'gate' cho cổng ra/vào

## State Transitions

### security_alerts status
new -> acknowledged -> resolved
(KHÔNG soft-delete, append-only)

### Alert Evaluation Flow
1. IVSS webhook → VehicleResolveService.onVehicleEvent()
2. INSERT iot_device_events (lấy source_event_id)
3. evaluate(plateNumber, context, eventId):
   - Check throttle (plateNumber key, 5 phút)
   - Resolve zone_id từ channelId
   - Priority chain: blocklist > watchlist > unknown > pending/rejected
   - evaluate() NOT throw (không block event ingest)
4. Nếu match → recordAlert() → createNotification()
