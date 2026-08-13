# TASKS — ROOM-SEARCH-FAULT-BADGE-001: Hiển thị tình trạng thiết bị khi tìm phòng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới tasks.md cho ROOM-SEARCH-FAULT-BADGE-001 (T001–T003). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (ROOM-SEARCH-FAULT-BADGE-001) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> KHÔNG commit.

---

## 0. Ràng buộc thực thi (áp cho mọi task)

| # | Chốt |
| :--- | :--- |
| 1 | Chỉ sửa `search()`/`RoomSearchRow`/`toItem()`/`RoomSearchItemDto` — KHÔNG đụng `getRoomDetail`/`RoomDetailResponseDto`/`rooms.controller.ts`. |
| 2 | `whereClause`/`countRows` query KHÔNG đổi. |
| 3 | `COUNT()` Postgres trả string — PHẢI `Number()` trước khi gán field `number`. |
| 4 | Loại thiết bị `deleted_at IS NOT NULL` khỏi mọi phép đếm. |

---

## T001 — [MODIFY additive] `RoomSearchItemDto` — 3 field mới
**File**: `src/modules/rooms/dto/room-search-item.dto.ts`

Thêm vào cuối class (sau `allowRecording`, dòng 21):
```ts
hasFaultyEquipment: boolean;
faultyEquipmentCount: number;
hasEquipmentWarning: boolean;
```

**DoD**: chỉ thêm 3 dòng, không đổi field cũ; tsc sạch.

---

## T002 — [MODIFY additive] `RoomSearchService` — SQL + mapping
**File**: `src/modules/rooms/services/room-search.service.ts`

1. SỬA `RoomSearchRow` interface (dòng 6-20): thêm `faulty_count: string | number; warning_count: string | number;`.
2. SỬA SELECT trong `search()` (dòng 78-87): đổi `FROM rooms r ${whereClause}` thành có `LEFT JOIN LATERAL (...) eq ON true` TRƯỚC `${whereClause}` (xem plan §1.1 cho SQL đầy đủ), thêm `COALESCE(eq.faulty_count,0) AS faulty_count, COALESCE(eq.warning_count,0) AS warning_count` vào SELECT list.
3. `countRows` query (dòng 89-92) — **KHÔNG đổi**.
4. SỬA `toItem()` (dòng 113-129): thêm map `hasFaultyEquipment: Number(row.faulty_count) > 0, faultyEquipmentCount: Number(row.faulty_count), hasEquipmentWarning: Number(row.warning_count) > 0`.

**DoD**: `whereClause`/`whereParams`/`countRows` không đổi 1 ký tự; SQL mới có `LEFT JOIN LATERAL` + `e.deleted_at IS NULL`; `toItem()` dùng `Number()` cho cả 2 field đếm; tsc sạch.

---

## T003 — [CREATE] Unit test + Cổng chất lượng
**File**: `src/modules/rooms/tests/room-search-equipment-badge.service.spec.ts`

5 case B1-B5 (xem plan §3). Mock `dataSource.manager.query` trả rows có `faulty_count`/`warning_count` dạng string (mô phỏng đúng hành vi Postgres thật).

Sau khi test pass:
1. `npx tsc --noEmit` — net +0.
2. `npx eslint` file đã sửa/tạo.
3. `npx jest src/modules/rooms` — suite mới pass + suite `search()` hiện có 0 regression (filter capacity/area/onlyAvailable vẫn đúng).
4. `git stash` so baseline `src/modules/rooms`.

**DoD**: 5 case B1-B5 pass; 0 regression; tsc/eslint sạch; **KHÔNG commit**.

---

## KHÔNG được làm
- KHÔNG sửa `getRoomDetail`/`RoomDetailResponseDto`/`rooms.controller.ts`. KHÔNG đổi `whereClause`/filter/pagination hiện có. KHÔNG thêm permission/index DB.
- **KHÔNG bắt đầu code cho tới khi có lệnh triển khai rõ ràng từ user.**

---

## Thứ tự thực thi
`T001 → T002 → T003`

> Chưa code — chờ duyệt spec/plan/tasks + lệnh triển khai.
