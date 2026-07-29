# PLAN FE — Nam đồng bộ FE theo BE — 2026-07-28

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-28 | Tạo mới: kết quả quét contract-mismatch FE↔BE (Pha 1) + hướng đã chốt cho Q1/Q2/Q4. Q3 (noShowStatus) đã được sửa ở BE, ghi nhận trong §Q1. | Toàn bộ file |
| 2026-07-28 (v2) | Đổi tên file `PLAN_NAM_SUA_FE_BE` → `PLAN_NAM_SUA_FE` (plan chỉ có việc FE). Siết lại 2 câu dễ đọc mơ hồ thành "không phải việc của Nam" / "sửa ở FE". Thêm dòng PHẠM VI ở đầu. | §Phạm vi (mới), §6.1, §9 |

> ### ⛔ PHẠM VI: CHỈ SỬA FE
> Toàn bộ việc trong plan này nằm trong repo **`FE_SmarTracking`**. **Không đụng repo `capstone-be`** — BE do Hải (trưởng nhóm) sửa. Mọi chỗ nhắc "BE" dưới đây chỉ là **thông tin đối chiếu** (BE đang đòi gì / trả gì) để Nam sửa FE cho khớp. Nếu gặp chỗ nào BE thiếu/sai → **báo Hải, không tự sửa BE**.

> **Nguyên tắc:** BE là nguồn chân lý. Mọi mục dưới đây **sửa FE**, KHÔNG đổi DTO/enum/validation BE.
> **Nguồn:** quét code sống 2026-07-28 — BE ~150 `*.dto.ts` + toàn bộ `*.entity.ts`; FE 17 `src/service/*.js` + 99 file `.js/.jsx`.
> Mỗi thay đổi để lại comment `// sync BE: <lý do>` để truy vết.

---

## 0. ĐÍNH CHÍNH BẢNG ENUM (4 chỗ hay bị hiểu nhầm)

| Hay bị ghi | Thực tế trong code |
|---|---|
| room status `active\|maintenance\|retired` | **`available\|occupied\|reserved\|maintenance\|inactive`** (`room.entity.ts:20`). Bộ `active\|maintenance\|retired` là `assetStatus` của **equipment fault DTO** |
| gate direction `enter\|leave\|seen` | Tuỳ route: `GATE_DIRECTIONS=['enter','leave']` (zones) — nhưng vehicle-history nhận `['enter','leave','seen']` |
| visibility `private\|participants\|department\|public_internal` | Đúng cho **minutes/notes**. **Media file** là `internal\|participants\|department\|public` — hai bộ khác nhau |
| `PATCH /media-files/:id/visibility` nhận trạng thái | Nhận **`action: 'hide' \| 'soft_delete'`**, không phải status |

---

## 1. 🔴 NHÓM A — Chắc chắn 400 khi bấm (6 mục)

| # | File:dòng | FE đang gửi | Sửa thành |
|---|---|---|---|
| A1 | `src/service/authService.js:56` | `{oldPassword, newPassword}` | `{currentPassword, newPassword, confirmPassword}` — cả 3 bắt buộc. JSDoc ngay trên **đã ghi đúng tên**, chỉ thân hàm sai. Đổi cả chữ ký hàm + màn gọi (truyền thêm confirm) |
| A2 | `src/pages/shared/MyVehicles.jsx:75` | `status:'ACTIVE'/'INACTIVE'` | `'active'/'disabled'` — ⚠ `INACTIVE`→**`disabled`**, KHÔNG phải `inactive` |
| A3 | `src/pages/bussinessAdmin/RecordingManagement.jsx:131` | `{visibility:'HIDDEN'}` | `{action:'hide'}` — sai cả tên field lẫn giá trị (xem thêm Q2, nút này phải đổi thành một chiều) |
| A4 | `src/pages/bussinessAdmin/RecordingManagement.jsx:63` | `getMeetings({status:'COMPLETED'})` | `'completed'` — BE `@IsIn(Object.values(MeetingStatus))`. `GET /meetings` nay **đã có** |
| A5 | `src/pages/employee/Recordings.jsx:47` | `{status:'COMPLETED', from, to}` | **thiếu `view` (BẮT BUỘC)**; `status` phải là **mảng** lowercase; `from/to` ISO **có offset**. Mẫu đúng: `src/pages/employee/PersonalCalendar.jsx:51-56` |
| A6 | `src/component/RealtimeRoomMonitor.jsx:146` | `{action:'IGNORE', reason}` | Xem **Q1** — field đúng là `detectionStatus`/`note` |

---

## 2. 🔴 NHÓM B — Path không tồn tại (2 mục)

**B1 — `src/service/sysAdminServices.js:382-397`**: `/vehicles/me`, `/vehicles`, `/vehicles/:id` → BE không có. Đúng là `/anpr/vehicle-registrations*`.
→ **Là code chết** (không màn nào import) nhưng `getMyVehicles` **trùng tên** với bản đúng ở `anprService.js` → bẫy import nhầm. **Xoá cả 4 hàm**, dùng `anprService`.

**B2 — `src/service/businessAdminServices.js:207-208`**: `PATCH /face-access/stranger-alerts/:id/resolve` → BE không có (FE đã tự ghi chú).
→ Dùng `POST /security-alerts/:id/resolve` (đã có sẵn `src/service/securityAlertService.js:42`), body **`{resolution_note}`** (snake_case).
→ ⚠ BE **ép luồng `new → acknowledged → resolved`**: resolve thẳng từ `new` trả **409**. UI phải cho ack trước.

---

## 3. 🟠 NHÓM C — Đọc response sai: không nổ lỗi nhưng UI hiện sai (5 mục)

| # | File:dòng | FE đọc | BE thật trả |
|---|---|---|---|
| C1 | `RealtimeRoomMonitor.jsx:260-280` | `room.status === 'NO_SHOW'/'IN_USE'/'AVAILABLE'` | field tên **`currentStatus`**, giá trị `available\|occupied\|reserved\|maintenance\|inactive`. **Không có `IN_USE`/`NO_SHOW`** — "đang dùng" là `occupied`; no-show đọc field riêng `noShowStatus` (xem Q1) |
| C2 | `RealtimeRoomMonitor.jsx:343-345` | `caseItem.status === 'PENDING'/'RELEASED'/'IGNORED'` | xem **Q1** |
| C3 | `systemAdmin/VehicleRegistrations.jsx:68-70` | badge `APPROVED/PENDING/REJECTED` | `status` chỉ `active\|disabled` → hiện không case nào khớp |
| C4 | `RecordingManagement.jsx:340-386` | `COMPLETED/FAILED/PARTIAL/HIDDEN` | xem **Q2** |
| C5 | `MyVehicles.jsx:165,167,178` | `vehicle.status === 'ACTIVE'` | `'active'` → UI **luôn** hiện "Tạm vô hiệu" kể cả xe đang chạy. Sửa cùng A2 (đổi gửi thì phải đổi cả đọc) |

**Kèm C1:** hàm `getRoomRealtimeStatus` (`businessAdminServices.js:171`) đang gọi nhầm `/rooms/search`. Đổi về **`GET /rooms/realtime-status`** (perm `room.utilization.read`).

---

## 4. 🟡 NHÓM D — Blob (1 sửa, gỡ 6 endpoint)

`src/utils/request.js` luôn `response.json()`; `responseType` bị bỏ qua hoàn toàn (`:60` không destructure, `:167` parse cứng).
→ Thêm nhánh: nếu `Content-Type` là `spreadsheetml` / `pdf` / `octet-stream` → `response.blob()` + trigger download, KHÔNG `.json()`.
→ Gỡ được: `GET /users/export`, `GET /users/import/template`, `GET /meetings/:id/participants/import/template`, `POST /reports/*/exports` (poll job rồi tải), minutes export, IVSS presence PDF.

---

## 5. ⭐ Q1 — No-show (đã chốt) — `RealtimeRoomMonitor.jsx`

### 5.1 BE đã sửa xong phần chặn (Q3)
`noShowStatus` trong `GET /rooms/realtime-status` và `GET /rooms/:id/status` **không còn hardcode `null`** — đã nối vào `no_show_cases` (case mới nhất của booking đang diễn ra). Giá trị: `risk|confirmed|warning_sent|released|dismissed|resolved`, `null` khi phòng không có booking đang chạy hoặc chưa có case.
→ FE đọc thẳng `room.noShowStatus` để vẽ badge. **Không cần gọi thêm API.**

### 5.2 Sửa chỗ GỬI (`:146`)
```js
// sync BE: UpdateNoShowDto chỉ nhận detectionStatus | resolutionStatus | note
await handleNoShowCase(caseId, { detectionStatus: 'dismissed', note: 'Bỏ qua bởi quản trị viên' });
```
Luật BE (`no-show.service.ts:194-262`) — **đọc kỹ, dễ ăn 400**:
- `detectionStatus` chỉ nhận **`confirmed | dismissed | resolved`** (`ALLOWED_UPDATE_TARGETS:37`).
- Gửi `warning_sent`/`released` → **400 `INVALID_NO_SHOW_TRANSITION`** (hệ thống tự đặt).
- Case đã ở trạng thái terminal (`resolved|dismissed|released`) → **400 `INVALID_NO_SHOW_TRANSITION`** ("already finalized") → UI phải **ẩn/disable nút** với case đã đóng.
- `resolvedBy` BE tự lấy từ JWT — **đừng gửi**.
- `resolutionStatus` (nếu dùng) chỉ nhận `kept | false_positive | manual_override`.

### 5.3 Sửa chỗ ĐỌC badge (`:343-345`)
| FE cũ | Đổi thành |
|---|---|
| `PENDING` | `risk` |
| `IGNORED` | `dismissed` |
| `RELEASED` | `released` |
| — (bổ sung) | `confirmed`, `warning_sent`, `resolved` |

Vocabulary đầy đủ: **`risk | confirmed | warning_sent | released | dismissed | resolved`**.

---

## 6. ⭐ Q2 — Recording status (đã chốt) — `RecordingManagement.jsx`

BE recording session: **`starting | recording | paused | stopped | failed | processing`**. BE đúng, KHÔNG sửa BE.

| FE cũ | Đổi thành | Chỗ sửa |
|---|---|---|
| `COMPLETED` | **`stopped`** | `:63`, `:130`, `:287`, `:340-386` |
| `FAILED` | **`failed`** (thường hoá) | `:340,346,360,368,386` |
| `PARTIAL` | **BỎ HẲN** — BE không phân biệt ghi một phần | xoá option `:288`, xoá nhánh `:355` |
| `HIDDEN` | **KHÔNG phải status** | xem 6.1 |

### 6.1 ⚠ "Ẩn" không phải trạng thái — và BE chỉ ẩn được MỘT CHIỀU
`PATCH /media-files/:id/visibility` nhận `{action:'hide'|'soft_delete'}`; `hide` → `is_active=false`, `soft_delete` → `deleted_at` (`media-files.service.ts:183-194`).
**BE KHÔNG có action "bỏ ẩn".** Nên `toggleVisibility` (`:129-131`) hiện tại — lật `HIDDEN ↔ COMPLETED` — **không thể giữ dạng toggle**. Sửa:
- Tách nút **"Ẩn"** khỏi cột trạng thái ghi hình; gọi `updateMediaVisibility(id, { action: 'hide' })`.
- Sau khi ẩn: nút disable, hiển thị theo `isActive === false` (field có trong `GET /media-files/:fileId`), KHÔNG dùng `status`.
- Muốn "bỏ ẩn" → BE chưa có endpoint. **KHÔNG phải việc của Nam** — chỉ cần báo Hải để đưa vào nợ BE; phía FE tạm không làm nút bỏ ẩn.

---

## 7. ⭐ Q4 — Bộ lọc UserManagement (đã chốt) — `UserManagement.jsx:108`

**Vấn đề:** FE gửi `locked/roleId/departmentId` tới `GET /users`, nhưng `ListUsersQueryDto` **chỉ có `page/limit/search`** → 3 tham số kia bị `whitelist` **strip im lặng** → lọc không có tác dụng, không báo lỗi.

**Chốt: chuyển sang `GET /users/manage`** (perm `accounts.user.manage`; Business Admin bị giới hạn theo department scope).

Query nhận: `departmentId` (uuid) · `roleId` (uuid) · `accountStatus` ∈ **`active|inactive|locked|pending_reset`** · `search` · `sortBy` ∈ `fullName|email|employeeCode|accountStatus|createdAt` (mặc định `fullName`) · `sortOrder` `asc|desc` · `page`=1 · `limit`=20 (max 100).

⚠ **Đổi cả shape response** — `data[]` mỗi item:
```
{ id, fullName, email, employeeCode|null, accountStatus, departmentId|null, roles: string[] /* roleCode */ }
```
+ `meta: {page, limit, total, totalPages}`.

Việc cần làm:
1. Thêm hàm mới trong `sysAdminServices`/`businessAdminServices`: `getUsersForManagement(params)` → `GET /users/manage`.
2. `:108` bỏ `locked: boolean`, đổi dropdown `'LOCKED'/'ACTIVE'` → gửi `accountStatus: 'locked'/'active'` (thêm được `inactive`, `pending_reset`).
3. Rà chỗ đọc response: item **không có** các field của `GET /users` cũ (vd `isLocked`, `department.name`) — chỉ có 7 field trên. Chỗ nào cần tên phòng ban phải map từ `departmentId` qua danh sách departments đã tải.

---

## 8. ✅ Đã đúng — KHÔNG đụng
`zoneServices.js:57` (PATCH + `{device_ids:[...]}`) · `AlertRules.jsx` + `SecurityAlerts.jsx` (snake_case + lowercase chuẩn) · `EquipmentManagement` faultForm (`healthStatus/assetStatus/issueNote` khớp DTO) · `PersonalCalendar.jsx` (getMySchedule đúng chuẩn).

## 9. ⚪ Mock nội bộ — KHÔNG đổi (không đi qua BE)
`employee/homePage.jsx:87-135` (consentStatus PENDING/GRANTED/REJECTED — mảng hardcode) · `systemAdmin/dashBoard.jsx:103-106` (device ONLINE/OFFLINE — mock).
`systemAdmin/DeviceManagement.jsx:635` đọc **đúng** lowercase (`'online'`), chỉ hiển thị chữ HOA. Nhưng BE trả 4 giá trị (`online|offline|disabled|maintenance`) mà FE chỉ vẽ 2 → `disabled`/`maintenance` bị hiện nhầm "OFFLINE". **Sửa ở FE**: thêm 2 nhãn hiển thị cho `disabled` và `maintenance` (BE giữ nguyên).

---

## 10. THỨ TỰ ĐỀ XUẤT
1. **A1-A6 + C5** — sửa cơ học, hết 400 (nửa ngày).
2. **B1-B2** — xoá code chết, hợp nhất service.
3. **Q1** — no-show (BE đã sẵn sàng, làm được ngay).
4. **Q2** — recording status + tách nút Ẩn.
5. **C1/C3** — sửa field/vocabulary đọc.
6. **Q4** — đổi endpoint + shape (đụng nhiều chỗ đọc nhất, làm sau cùng).
7. **D (blob)** — sửa `request.js`, gỡ 6 endpoint tải file.

Sau mỗi cụm: `npm run build` FE phải pass.
