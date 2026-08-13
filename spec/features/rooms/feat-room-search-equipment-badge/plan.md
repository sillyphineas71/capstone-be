# PLAN — ROOM-SEARCH-FAULT-BADGE-001: Hiển thị tình trạng thiết bị khi tìm phòng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới plan.md cho ROOM-SEARCH-FAULT-BADGE-001. | Toàn bộ file |

> Dựa trên `spec.md` (ROOM-SEARCH-FAULT-BADGE-001) đã duyệt. **CHỈ kế hoạch** — KHÔNG code.

---

## 0. Ràng buộc & quyết định đã chốt (không mở lại)

| # | Chốt |
| :--- | :--- |
| 1 | Đặt badge ở `RoomSearchItemDto`/`RoomSearchService` (`GET /rooms/search`) — KHÔNG đụng `RoomDetailResponseDto`/`getRoomDetail()`. |
| 2 | KHÔNG filter theo badge (`onlyWithFaultyEquipment`) trong feature này. |
| 3 | `warning` CÓ hiển thị (`hasEquipmentWarning`), khác booking gate (chỉ faulty/offline). |
| 4 | JOIN bằng `LEFT JOIN LATERAL` subquery, loại `deleted_at IS NOT NULL`. |
| 5 | KHÔNG đổi `whereClause`/filter/pagination hiện có. |

---

## 1. Kiến trúc & luồng

### 1.1. SQL mới trong `search()`
Thay SELECT hiện tại (dòng 78-87) bằng (xem spec §6 cho SQL đầy đủ):
```sql
SELECT r.id, r.room_code, ..., r.allow_recording,
       COALESCE(eq.faulty_count, 0) AS faulty_count,
       COALESCE(eq.warning_count, 0) AS warning_count
FROM rooms r
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE health_status IN ('faulty','offline')) AS faulty_count,
         COUNT(*) FILTER (WHERE health_status = 'warning') AS warning_count
  FROM equipments e WHERE e.current_room_id = r.id AND e.deleted_at IS NULL
) eq ON true
${whereClause}
ORDER BY r.room_code ASC
LIMIT $5 OFFSET $6
```
`whereClause`/`whereParams`/`countRows` query (dòng 67-93 hiện tại) **KHÔNG đổi** — count query không cần JOIN (không lọc theo equipment).

### 1.2. `RoomSearchRow` interface (SỬA — additive)
```ts
interface RoomSearchRow {
  // ... field cũ giữ nguyên
  faulty_count: string | number;  // Postgres COUNT() trả string qua node-postgres, cần Number()
  warning_count: string | number;
}
```

### 1.3. `toItem()` (SỬA — additive)
```ts
private toItem(row: RoomSearchRow): RoomSearchItemDto {
  return {
    // ... field cũ giữ nguyên
    hasFaultyEquipment: Number(row.faulty_count) > 0,
    faultyEquipmentCount: Number(row.faulty_count),
    hasEquipmentWarning: Number(row.warning_count) > 0,
  };
}
```
Lưu ý: `COUNT()`/`COUNT(*) FILTER` qua `node-postgres` trả về **string**, PHẢI `Number()` trước khi so sánh/gán — lỗi thường gặp nếu bỏ qua (so sánh string `"0" > 0` vẫn đúng do JS coercion nhưng để field `faultyEquipmentCount` đúng kiểu `number` bắt buộc `Number()`).

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/rooms/tests/room-search-equipment-badge.service.spec.ts` | Unit test nhánh mới |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/rooms/services/room-search.service.ts` | SỬA SQL trong `search()` (SELECT + LATERAL JOIN), SỬA `RoomSearchRow` interface, SỬA `toItem()`. `whereClause`/count query KHÔNG đổi. |
| `src/modules/rooms/dto/room-search-item.dto.ts` | THÊM 3 field: `hasFaultyEquipment`, `faultyEquipmentCount`, `hasEquipmentWarning`. |

> KHÔNG sửa `rooms.controller.ts` (route `search` không đổi signature). KHÔNG sửa `room-detail-response.dto.ts`/`rooms.service.ts` (`getRoomDetail`).

---

## 3. Test plan (liệt kê — implement ở bước sau)

`room-search-equipment-badge.service.spec.ts` (mock `dataSource.manager.query` trả về rows giả lập với `faulty_count`/`warning_count`):
- **B1**: row có `faulty_count='2'` → `hasFaultyEquipment=true, faultyEquipmentCount=2` (kiểu number, không phải string).
- **B2**: row có `faulty_count='0', warning_count='0'` → cả 3 field false/0.
- **B3**: row có `warning_count='1'` → `hasEquipmentWarning=true, hasFaultyEquipment=false`.
- **B4**: verify SQL query string có chứa `LEFT JOIN LATERAL` và `e.deleted_at IS NULL` (assert trên câu query được gọi, không cần DB thật).
- **B5**: filter hiện có (`capacityMin`, `onlyAvailable`) vẫn hoạt động đúng — verify `whereParams` không đổi.

---

## 4. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| `COUNT()` trả string từ Postgres, quên `Number()` | Test B1 assert kiểu `number`, không phải `'2'`. |
| `LEFT JOIN LATERAL` làm sai lệch `countRows` (tổng số phòng) | `countRows` query (dòng 89-92) giữ nguyên KHÔNG JOIN — chỉ SELECT chính mới JOIN. |
| Phòng có nhiều thiết bị cùng `current_room_id` nhưng khác `health_status` bị đếm sai | Dùng `COUNT(*) FILTER (WHERE ...)` — Postgres native, đếm đúng theo điều kiện, test B1-B3 verify. |
| Query chậm hơn với dataset lớn (LATERAL join mỗi phòng) | Không có index riêng trên `equipments.current_room_id` hiện tại (đã verify ở khảo sát trước) — chấp nhận được cho scope hiện tại (dataset demo/capstone nhỏ), ghi chú làm rõ nếu cần optimize sau, KHÔNG tự thêm index ngoài yêu cầu. |

---

## 5. Tác động code người khác

- KHÔNG sửa `RoomDetailResponseDto`/`getRoomDetail()`/`rooms.controller.ts`.
- KHÔNG sửa `whereClause`/`countRows` query.
- KHÔNG đổi response shape cấp cao (`{success,message,data,meta}`) — chỉ thêm field trong từng item của `data`.

---

## 6. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/rooms/tests/room-search-equipment-badge.service.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/rooms/services/room-search.service.ts` (SQL + interface + `toItem`)
- [ ] `src/modules/rooms/dto/room-search-item.dto.ts` (+3 field)

**KHÔNG làm**: sửa `getRoomDetail`/`RoomDetailResponseDto`; đổi `whereClause`/filter/pagination; thêm permission; thêm index DB; implement booking gate (`feat-room-equipment-fault-warning` riêng).
