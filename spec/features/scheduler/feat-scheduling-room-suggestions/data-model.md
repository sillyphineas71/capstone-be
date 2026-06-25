# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới data-model.md cho UC-SM-01 | Toàn bộ file |

---

# Data Model: UC-SM-01 — Xem danh sách phòng họp đề xuất

## 1. Entities Involved

### 1.1 `rooms` (RoomEntity)
| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Định danh phòng |
| `room_code` | varchar(80) | Mã phòng trả về response |
| `room_name` | varchar(150) | Tên phòng trả về response |
| `capacity` | integer | Filter: chỉ phòng có `capacity >= attendeeCount` |
| `room_type` | varchar(50) | Optional filter: `meeting_room`, `board_room`, `training_room`, `open_space` |
| `site_name` | varchar(150) | Optional filter |
| `area_name` | varchar(150) | Optional filter (spec có `areaName` query param) |
| `current_status` | varchar(30) | Exclude: `maintenance`, `inactive` |
| `is_active` | boolean | Required: chỉ `is_active = true` |
| `deleted_at` | timestamptz | Required: `deleted_at IS NULL` |
| `allow_recording` | boolean | Optional filter |
| `has_camera` | boolean | Legacy flag (ưu tiên dùng equipments cho logic EXISTS) |
| `has_microphone` | boolean | Legacy flag |
| `has_display` | boolean | Legacy flag |

### 1.2 `room_bookings` (RoomBookingEntity)
| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Định danh booking |
| `room_id` | uuid FK | Join với rooms để check overlap |
| `reserved_start_time` | timestamptz | Overlap check: `existing < :endTime` |
| `reserved_end_time` | timestamptz | Overlap check: `existing > :startTime` |
| `status` | varchar(30) | Filter: chỉ tính conflict với `pending`, `approved`, `active` |

### 1.3 `equipments` (EquipmentEntity)
| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Định danh equipment |
| `equipment_type` | varchar(50) | Filter: `camera`, `microphone`, `display` tương ứng query params |
| `asset_status` | varchar(30) | Chỉ tính equipment `assigned` |
| `health_status` | varchar(30) | Chỉ tính equipment `healthy` |
| `current_room_id` | uuid FK | Join với rooms: equipment gắn phòng nào |
| `deleted_at` | timestamptz | Required: chỉ equipment chưa bị xóa |

## 2. Query Pattern

### 2.1 Core Query: Find available rooms

```typescript
// Bước 1: Lấy tất cả rooms active, đủ capacity, không maintenance/inactive
const roomsQuery = this.entityManager
  .createQueryBuilder(RoomEntity, 'room')
  .where('room.is_active = :isActive', { isActive: true })
  .andWhere('room.deleted_at IS NULL')
  .andWhere('room.capacity >= :attendeeCount', { attendeeCount })
  .andWhere('room.current_status NOT IN (:...excludedStatuses)', {
    excludedStatuses: ['maintenance', 'inactive'],
  });

// Optional filters
if (roomType) roomsQuery.andWhere('room.room_type = :roomType', { roomType });
if (siteName) roomsQuery.andWhere('room.site_name = :siteName', { siteName });
if (allowRecording === true) roomsQuery.andWhere('room.allow_recording = :allowRecording', { allowRecording: true });

// Optional equipment boolean filters — check EXISTS in equipments
// Lưu ý: nếu hasCamera/hasMicrophone/hasDisplay = true, thêm subquery EXISTS

// Bước 2: Loại trừ rooms có booking overlap
roomsQuery.andWhere(qb => {
  const subQuery = qb
    .subQuery()
    .select('1')
    .from(RoomBookingEntity, 'booking')
    .where('booking.room_id = room.id')
    .andWhere('booking.reserved_start_time < :endTime')
    .andWhere('booking.reserved_end_time > :startTime')
    .andWhere('booking.status IN (:...conflictingStatuses)', {
      conflictingStatuses: ['pending', 'approved', 'active'],
    })
    .getQuery();
  return 'NOT EXISTS (' + subQuery + ')';
})
.setParameter('startTime', startTime)
.setParameter('endTime', endTime);

// Bước 3: Equipment EXISTS subqueries (nếu có)
if (hasCamera) {
  roomsQuery.andWhere(qb => {
    const sub = qb
      .subQuery()
      .select('1')
      .from(EquipmentEntity, 'eq')
      .where('eq.current_room_id = room.id')
      .andWhere("eq.equipment_type = 'camera'")
      .andWhere("eq.asset_status = 'assigned'")
      .andWhere("eq.health_status = 'healthy'")
      .andWhere('eq.deleted_at IS NULL')
      .getQuery();
    return 'EXISTS (' + sub + ')';
  });
}
// Tương tự cho hasMicrophone, hasDisplay
```

### 2.2 Sort & Limit

```typescript
// Sort: capacity - attendeeCount ASC, room_name ASC, room_code ASC
roomsQuery.orderBy('room.capacity - :attendeeCount', 'ASC')
  .addOrderBy('room.room_name', 'ASC')
  .addOrderBy('room.room_code', 'ASC');

const rooms = await roomsQuery.getMany();
const result = rooms.slice(0, 20); // limit 20
```

### 2.3 Score Calculation

```typescript
function calculateScore(capacity: number, attendeeCount: number): number {
  const diff = capacity - attendeeCount;
  if (diff === 0) return 100; // perfect match
  // score giảm dần khi diff tăng
  return Math.max(0, 100 - (diff / capacity) * 100);
}
```

### 2.4 matchedFeatures Calculation

```typescript
// Sau khi có danh sách rooms, tính matchedFeatures cho từng phòng
// Dựa trên các equipment boolean đã được yêu cầu và equipment thực tế trong phòng
// Nếu hasCamera=true và room có camera healthy → thêm "camera" vào matchedFeatures
// Nếu không truyền boolean nào → matchedFeatures = [] (mặc định)

// Dùng 1 query tổng hợp:
// SELECT eq.current_room_id, eq.equipment_type
// FROM equipments eq
// WHERE eq.current_room_id IN (:...roomIds)
//   AND eq.asset_status = 'assigned'
//   AND eq.health_status = 'healthy'
//   AND eq.deleted_at IS NULL
//   AND (true) -- hoặc lọc theo equipment_type nếu user yêu cầu
// Group by room_id → matchedFeatures list
```

## 3. State Transitions

| State/Filter | Action | Notes |
|---|---|---|
| `rooms.current_status = 'maintenance'` | Exclude room | Không đề xuất |
| `rooms.current_status = 'inactive'` | Exclude room | Không đề xuất |
| `rooms.is_active = false` | Exclude room | Không đề xuất |
| `rooms.deleted_at IS NOT NULL` | Exclude room | Soft delete |
| `room_bookings.status = 'pending'/'approved'/'active'` | Overlap → exclude room | Conflict |
| `room_bookings.status = 'completed'/'cancelled'/'released'` | Không tính conflict | Bỏ qua |
| `equipments.asset_status != 'assigned'` | Equipment không hợp lệ | Không tính cho matchedFeatures |
| `equipments.health_status != 'healthy'` | Equipment không khả dụng | Không tính cho matchedFeatures |

