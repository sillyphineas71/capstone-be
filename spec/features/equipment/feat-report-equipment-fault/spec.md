# SPEC — UC-62: Cập nhật trạng thái lỗi thiết bị (Report / update equipment fault)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec.md cho UC-62 (báo lỗi / chuyển bảo trì thiết bị). Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-62** — báo lỗi thiết bị và/hoặc chuyển thiết bị sang bảo trì.
> KHÔNG bao gồm create (UC-61), xóa (UC-63), tìm kiếm (UC-64), phân bổ phòng (UC-65).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code, plan, tasks.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Nền module `equipment` (sau UC-61)
| Thành phần | Hiện trạng |
| :--- | :--- |
| `entities/equipment.entity.ts` | ✅ Có đủ field (enum `AssetStatus`, `HealthStatus`; `lastIssueReportedAt`, `lastIssueNote`, `lastMaintenanceAt`, `currentRoomId`, `assignedBy/At`). |
| `services/equipment.service.ts` | ✅ Có `EquipmentService` với `create()` (UC-61). **Chưa có** method update fault. |
| `controllers/equipment.controller.ts` | ✅ Có `EquipmentController` với 1 endpoint `POST /equipments` (UC-61). **Chưa có** endpoint fault. |
| `equipment.module.ts` | ✅ Đã wire `AuthModule`, `JwtModule`, `controllers:[EquipmentController]`, `providers:[EquipmentService]`. |
| Permission | Chỉ `equipment.create` (seed `20260713000003`). |

→ **UC-62 = [Missing]**. Sẽ **THÊM method + endpoint** vào `EquipmentService`/`EquipmentController` sẵn có (mirror pattern UC-61). **KHÔNG tạo service/controller mới**, **KHÔNG tạo entity/migration**.

### 0.2. Không tồn tại logic "gợi ý thiết bị cho phòng"
Khảo sát toàn `src/modules` (`grep suggest.*equipment|equipment.*suggest`, filter theo `assetStatus/healthStatus`): **KHÔNG có** UC/logic nào gợi ý hoặc filter thiết bị theo trạng thái khi đặt phòng.

⇒ Expected Output "loại khỏi gợi ý đặt phòng" là **HỆ QUẢ downstream** của việc set `assetStatus=maintenance`/`healthStatus=faulty`, **không phải hành vi UC-62 tự thực thi**. UC-62 chỉ **ghi nhận trạng thái**; việc filter khi gợi ý là trách nhiệm của UC gợi ý thiết bị (chưa tồn tại — future). Spec này KHÔNG implement filter đó.

### 0.3. Mirror pattern UC-61
- `EquipmentService.create` (`services/equipment.service.ts`): load/kiểm → cập nhật trong `dataSource.transaction` → audit **fail-separate** (transaction riêng, try/catch, không rollback) → map response.
- `EquipmentController.create` (`controllers/equipment.controller.ts`): `@UseGuards(JwtAuthGuard)` (class) + `PermissionsGuard` (method) + `@RequirePermissions(...)` + `ValidationPipe(whitelist+forbidNonWhitelisted+transform)` + `@CurrentUser()` + `@Ip()`, trả `{success,message,data}`.
- `ConflictException` payload chuẩn `{success:false,message,error:{code,details},timestamp,path}`.
- Seed permission mirror `SeedEquipmentCreatePermission` / `SeedIotDeviceReadPermission`.

---

## 1. Tổng quan Use Case

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Use Case ID** | UC-62 |
| **Use Case Name** | Cập nhật trạng thái lỗi thiết bị (Report / update equipment fault) |
| **Module** | Equipment Management (`src/modules/equipment`) |
| **Primary Actor** | Business Admin / Internal User (xác nhận RBAC — xem §8) |
| **Trigger** | Người dùng báo hỏng thiết bị (thiết bị lỗi/không hoạt động). |
| **Expected Output** | Thiết bị chuyển trạng thái **Bảo trì** (`assetStatus=maintenance`) và/hoặc **Hư hỏng** (`healthStatus=faulty`); được **loại khỏi gợi ý đặt phòng** (hệ quả từ trạng thái — §0.2). |
| **Pre-condition** | Thiết bị tồn tại. |
| **Related** | UC-57, UC-61 (cùng nhóm Equipment Management); UC-63/64/65 — KHÔNG thuộc UC-62. |

---

## 2. Actor & Pre-condition

### 2.1. Actor (báo cáo vs xử lý — cần chốt §8)
- **Internal User**: người dùng nội bộ **báo hỏng** thiết bị (report).
- **Business Admin**: quản trị tài sản, **xử lý** — chuyển bảo trì (`maintenance`).
- Câu hỏi RBAC: **Internal User có được đổi `assetStatus=maintenance` không, hay chỉ báo trạng thái hư hỏng (`healthStatus`)?** → phân tích + đề xuất §8.

### 2.2. Pre-condition
- PRE-01: Actor đã xác thực (JWT) — `JwtAuthGuard`.
- PRE-02: Actor có permission tương ứng (§8) — `PermissionsGuard`.
- PRE-03: Thiết bị tồn tại (`equipmentId` hợp lệ, chưa soft-deleted) → không có ⇒ 404.
- PRE-04: Thiết bị **không** ở trạng thái không cho báo lỗi (`retired`/`lost` — đề xuất chặn, §7).

---

## 3. Endpoint

### 3.1. Đề xuất
```
PATCH /api/v1/equipments/:equipmentId/fault
```

| Thuộc tính | Giá trị |
| :--- | :--- |
| Method | `PATCH` (cập nhật một phần trạng thái) |
| Path | `/api/v1/equipments/:equipmentId/fault` |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.report_fault` (đề xuất — §8) |
| Success status | `200 OK` |
| Handler | `EquipmentController.reportFault` (THÊM) |
| Service | `EquipmentService.reportFault` (THÊM) |

### 3.2. Lựa chọn tên (cần chốt §11)
- **`/fault`** (khuyến nghị): rõ nghĩa "báo lỗi/hư hỏng", tách biệt update chung.
- `/report-issue`: tương đương, dài hơn.
- `/status`: quá rộng — có thể lẫn với đổi trạng thái tổng quát (assign/available), dễ bị lạm dụng để set về `healthy/available` → không khuyến nghị cho UC-62.

`:equipmentId` dùng `ParseUUIDPipe`.

---

## 4. Input — `ReportEquipmentFaultDto`

Bám entity thật. Body:

| Field (DTO) | Cột DB | Kiểu | Bắt buộc? | Ràng buộc |
| :--- | :--- | :--- | :--- | :--- |
| `healthStatus?` | `health_status` | enum `HealthStatus` (con) | Tùy chọn* | `@IsOptional`, `@IsEnum`, **chỉ nhận `warning`/`faulty`/`offline`** (§6) |
| `assetStatus?` | `asset_status` | enum `AssetStatus` (con) | Tùy chọn* | `@IsOptional`, `@IsEnum`, **chỉ nhận `maintenance`** (§6) |
| `issueNote?` | `last_issue_note` | text | Tùy chọn (khuyến nghị bắt buộc — §11) | `@IsOptional`, `@IsString`, `@MaxLength(2000)` (đề xuất) |

\* **Ràng buộc "ít nhất một"**: phải có tối thiểu 1 trong (`healthStatus`, `assetStatus`) → nếu cả hai trống ⇒ 400/422 (`FAULT_NO_CHANGE`). `issueNote` một mình không đủ để "báo lỗi" (đề xuất; có thể chốt cho phép note-only nếu team muốn).

DTO KHÔNG nhận field khác (`equipmentCode/currentRoomId/iotDeviceId/...`) → `forbidNonWhitelisted` reject.

---

## 5. Main Flow

1. Actor gửi `PATCH /api/v1/equipments/:equipmentId/fault` + `ReportEquipmentFaultDto`.
2. `JwtAuthGuard` → `currentUserId`; `PermissionsGuard` kiểm permission (§8).
3. `ValidationPipe` validate DTO (enum con, "ít nhất một", độ dài note).
4. `EquipmentService.reportFault(equipmentId, dto, userId, ipAddress)`:
   1. Load equipment (`findOne`, không lấy soft-deleted) → không có ⇒ 404 `EQUIPMENT_NOT_FOUND`.
   2. Kiểm trạng thái cho phép báo lỗi: nếu `assetStatus ∈ {retired, lost}` ⇒ 409 `EQUIPMENT_NOT_REPORTABLE` (§7).
   3. Lưu `oldValue` (health+asset status) cho audit.
   4. Cập nhật **trong transaction**: set `healthStatus` (nếu có), `assetStatus` (nếu có), `lastIssueReportedAt = now`, `lastIssueNote = dto.issueNote ?? equipment.lastIssueNote`. (`lastMaintenanceAt` — §6.3.)
   5. Xử lý `currentRoomId` khi chuyển maintenance — §7.2 (đề xuất **giữ nguyên**).
   6. Audit **fail-separate** (§9).
5. Trả `200` + `{success, message, data: EquipmentResponseDto}`.

---

## 6. Ngữ nghĩa cập nhật & ràng buộc giá trị

### 6.1. `healthStatus` — chỉ chiều "xấu đi"
Endpoint fault **chỉ** cho set: `warning`, `faulty`, `offline`. **KHÔNG** cho set `healthy`/`unknown` (đó là "sửa xong"/reset — thuộc UC recovery khác, §10).

### 6.2. `assetStatus` — chỉ `maintenance`
Endpoint fault **chỉ** cho set `assetStatus = maintenance`. KHÔNG cho set `available/assigned/retired/lost` qua endpoint này (mỗi cái thuộc UC khác: available/assigned=UC-65 phân bổ/recovery; retired/lost=UC-63/thanh lý).

### 6.3. `lastMaintenanceAt` — phân tích (cần chốt §11)
- Ngữ nghĩa `lastMaintenanceAt` = "lần bảo trì **gần nhất được thực hiện/hoàn tất**".
- Báo lỗi/chuyển sang `maintenance` là **bắt đầu** cần bảo trì, **chưa** bảo trì xong.
- **Đề xuất**: **KHÔNG** set `lastMaintenanceAt` ở UC-62. Chỉ cập nhật `lastIssueReportedAt` + `lastIssueNote`. `lastMaintenanceAt` được set khi hoàn tất bảo trì (UC recovery/khác).

### 6.4. Luôn set
- `lastIssueReportedAt = now` (server, không nhận từ input).
- `lastIssueNote = dto.issueNote` (nếu có; nếu không truyền, giữ note cũ — đề xuất, hoặc bắt buộc note §11).

---

## 7. Ràng buộc trạng thái

### 7.1. Thiết bị `retired`/`lost` (cần chốt §11)
- **Đề xuất chặn**: `assetStatus ∈ {retired, lost}` ⇒ 409 `EQUIPMENT_NOT_REPORTABLE`. Lý do: thiết bị đã thanh lý/mất không còn trong vòng vận hành để "báo hỏng/bảo trì".

### 7.2. Thiết bị `assigned` (đang gán phòng) chuyển `maintenance` — xử lý `currentRoomId` (cần chốt §11)
| Phương án | `currentRoomId` | Phân tích |
| :--- | :--- | :--- |
| **A (khuyến nghị)** | **Giữ nguyên** | UC-62 chỉ đổi **trạng thái**; vị trí vật lý (đang lắp ở phòng) không đổi. "Loại khỏi gợi ý" đạt được nhờ `assetStatus=maintenance` (status filter), không cần gỡ room. Gỡ khỏi phòng (un-assign, xóa `assigned_by/at`) là nghiệp vụ **UC-65**. Ranh giới sạch. |
| B | Gỡ `currentRoomId=null` + clear `assigned_*` | Tự động "release" khi maintenance. Nhược điểm: lấn UC-65, mất thông tin thiết bị đang lắp ở đâu để đi sửa. |

→ **Đề xuất A** (giữ `currentRoomId`, chỉ đổi status). Ghi rõ để UC gợi ý (future) filter theo `assetStatus/healthStatus`.

---

## 8. Permission / RBAC (điểm chốt quan trọng)

### 8.1. Vấn đề: report vs process
- **Báo hỏng (report health)**: hành động nhẹ, Internal User nên được phép (họ phát hiện lỗi).
- **Chuyển bảo trì (`assetStatus=maintenance`)**: hành động vận hành tài sản, thường thuộc Business Admin.

### 8.2. Phương án
| Phương án | Mô tả |
| :--- | :--- |
| **P1 (khuyến nghị MVP)** | **1 permission `equipment.report_fault`** cho endpoint, gán `[SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, INTERNAL_USER]`. Cho phép cả set `healthStatus` lẫn `assetStatus=maintenance`. Đơn giản, đủ cho capstone. |
| P2 (tách quyền) | 2 mức: Internal User chỉ set `healthStatus` (+note); chỉ `[SYSTEM_ADMIN,BUSINESS_ADMIN]` được set `assetStatus=maintenance`. Cần logic kiểm quyền theo field trong service (phức tạp hơn). |

- **Đề xuất P1** cho MVP; ghi P2 là hướng siết quyền tương lai.
- Permission mới (mirror `equipment.create`): `permission_code='equipment.report_fault'`, `module_code='equipment'`, `action_code='report_fault'`.
- ⇒ Điểm cần chốt C-actor (§11).

---

## 9. Audit logging

Báo lỗi/đổi trạng thái tài sản là hành động quan trọng (CLAUDE.md §17) → **PHẢI** ghi `audit_logs`, mirror cách UC-61:

| Trường | Giá trị |
| :--- | :--- |
| `userId` | `currentUserId` |
| `actionType` | `update` *(theo convention UC-61 dùng lowercase `create`; hoặc `report_fault` mô tả hơn — chốt §11)* |
| `entityType` | `equipment` |
| `entityId` | `equipmentId` |
| `oldValueJson` | `{ healthStatus, assetStatus }` (trước) |
| `newValueJson` | `{ healthStatus, assetStatus, lastIssueReportedAt, issueNote }` (sau) |
| `ipAddress` | `@Ip()` |
| `severity` | `WARNING` (đề xuất — sự cố thiết bị; `INFO` cũng chấp nhận) |

Ghi **ngoài** transaction cập nhật (fail-separate) — audit lỗi KHÔNG rollback việc đổi trạng thái.

---

## 10. Ranh giới UC-62 vs UC lân cận

| Việc | Thuộc UC | UC-62 làm? |
| :--- | :--- | :--- |
| Báo lỗi (set `healthStatus` warning/faulty/offline) + note | **UC-62** | ✅ |
| Chuyển `assetStatus=maintenance` | **UC-62** | ✅ (theo P1) |
| Tạo thiết bị | UC-61 | ❌ |
| Xóa thiết bị | UC-63 | ❌ |
| Tìm kiếm/list | UC-64 | ❌ |
| Phân bổ/gỡ khỏi phòng (`assigned`, `currentRoomId`, `assigned_*`) | UC-65 | ❌ |
| **"Sửa xong → về `healthy`/`available`"** (recovery, chiều ngược) | **UC khác/future** (không phải UC-62) | ❌ |
| Filter thiết bị lỗi khỏi gợi ý đặt phòng | UC gợi ý thiết bị (future) | ❌ (chỉ set trạng thái để UC đó dùng) |

**Làm rõ "sửa xong → về healthy"**: KHÔNG thuộc UC-62. UC-62 chỉ chiều "xấu đi" (report/maintenance). Recovery (đưa về `healthy`/`available` sau khi sửa) là một UC riêng (đảo trạng thái, cần quyền + audit riêng) — ngoài phạm vi.

---

## 11. Điểm cần chốt

| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| C1 | Tên endpoint | `PATCH /equipments/:equipmentId/fault` |
| C2 | Actor/RBAC: Internal User được set `assetStatus=maintenance`? | **P1**: 1 permission `equipment.report_fault` cho `[SYSTEM_ADMIN,BUSINESS_ADMIN,MANAGER,INTERNAL_USER]`, cho cả 2 field |
| C3 | Giá trị cho set | `healthStatus ∈ {warning,faulty,offline}`; `assetStatus = maintenance` only; chặn `healthy/available` |
| C4 | `lastMaintenanceAt` set ở UC-62? | **KHÔNG** (chỉ set khi hoàn tất bảo trì — UC khác) |
| C5 | `currentRoomId` khi maintenance | **Giữ nguyên** (Phương án A) — gỡ room là UC-65 |
| C6 | `retired/lost` có cho báo lỗi? | **Chặn** → 409 `EQUIPMENT_NOT_REPORTABLE` |
| C7 | `issueNote` bắt buộc? | Đề xuất **bắt buộc** khi báo `faulty`; tùy chọn với `warning` (hoặc chốt luôn optional) |
| C8 | "Ít nhất một" (healthStatus/assetStatus) | Bắt buộc ≥1; cả hai trống → 400/422 `FAULT_NO_CHANGE` |
| C9 | `audit_logs.actionType` | `update` (đồng nhất UC-61) hoặc `report_fault` |
| C10 | Recovery (về healthy) | KHÔNG thuộc UC-62 — UC riêng future |

---

## 12. Functional Requirements

- **FR-01**: Cung cấp `PATCH /api/v1/equipments/:equipmentId/fault` để báo lỗi / chuyển bảo trì.
- **FR-02**: Chỉ user có permission `equipment.report_fault` được gọi (thiếu → 403).
- **FR-03**: Thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`.
- **FR-04**: `retired/lost` → 409 `EQUIPMENT_NOT_REPORTABLE`.
- **FR-05**: Body phải có ≥1 trong (`healthStatus`, `assetStatus`); trống → 400/422 `FAULT_NO_CHANGE`.
- **FR-06**: `healthStatus` chỉ nhận `warning/faulty/offline`; `assetStatus` chỉ nhận `maintenance`; giá trị khác → 422.
- **FR-07**: Set `lastIssueReportedAt=now`, `lastIssueNote` (nếu có). KHÔNG set `lastMaintenanceAt`.
- **FR-08**: Giữ nguyên `currentRoomId` (không auto-release).
- **FR-09**: Ghi `audit_logs` (fail-separate) với old/new status + note.
- **FR-10**: Trả bản ghi thiết bị sau cập nhật theo `{success,message,data}`.
- **FR-11**: KHÔNG cho set `healthy/available` (recovery) qua endpoint này.

## 13. Non-Functional Requirements

- **NFR-01**: TypeORM, không Prisma; transaction cho cập nhật; audit fail-separate.
- **NFR-02**: DTO validate ở boundary (whitelist/forbidNonWhitelisted/transform).
- **NFR-03**: Dùng enum `AssetStatus`/`HealthStatus` sẵn có, không magic string.
- **NFR-04**: Không log secret; error theo exception filter chuẩn.
- **NFR-05**: Chỉ THÊM vào `EquipmentService`/`EquipmentController` (không tạo service mới, không sửa `create`).

## 14. Acceptance Criteria

- **AC-01**: PATCH với `healthStatus=faulty` hợp lệ → 200, `data.healthStatus='faulty'`, `lastIssueReportedAt` được set.
- **AC-02**: PATCH với `assetStatus=maintenance` → 200, `data.assetStatus='maintenance'`.
- **AC-03**: Body trống (`{}`) → 400/422 `FAULT_NO_CHANGE`.
- **AC-04**: `healthStatus=healthy` → 422 (không cho recovery).
- **AC-05**: `assetStatus=available` → 422.
- **AC-06**: Thiết bị không tồn tại → 404.
- **AC-07**: Thiết bị `retired` → 409 `EQUIPMENT_NOT_REPORTABLE`.
- **AC-08**: Thiếu permission → 403; chưa đăng nhập → 401.
- **AC-09**: Ghi 1 dòng `audit_logs` (`entityType='equipment'`, có old/new status).
- **AC-10**: `currentRoomId` không đổi sau khi chuyển maintenance.

## 15. Exception / Alternative Flows

- **EC-01**: 404 thiết bị không tồn tại → không cập nhật.
- **EC-02**: 409 `retired/lost`.
- **EC-03**: 422 giá trị enum không hợp lệ / recovery bị chặn.
- **EC-04**: 400/422 `FAULT_NO_CHANGE` (không có thay đổi).
- **EC-05**: Audit ghi lỗi → log warning, KHÔNG rollback cập nhật (fail-separate).

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]** — module `equipment` mới có `create` (UC-61); chưa có update fault.

Danh mục triển khai (ở plan/tasks sau, KHÔNG làm trong spec này):
1. THÊM `EquipmentService.reportFault(equipmentId, dto, userId, ip)` — load/404 → kiểm retired/lost/409 → transaction cập nhật status + issue fields → audit fail-separate. (KHÔNG sửa `create`.)
2. THÊM `EquipmentController.reportFault` — `PATCH :equipmentId/fault`, guard + `@RequirePermissions('equipment.report_fault')` + ValidationPipe.
3. TẠO `ReportEquipmentFaultDto` (+ tái dùng `EquipmentResponseDto`).
4. TẠO seed `equipment.report_fault` (KHÔNG execute) — role-set theo C2.
5. Test service (report health, chuyển maintenance, 404, retired 409, recovery bị chặn 422, no-change, currentRoomId giữ, audit fail-separate) + controller (RBAC, response).

**Điểm cần chốt trước khi code**: C1–C10 (§11) — đặc biệt: quyền Internal User (C2), giá trị cho set (C3), `lastMaintenanceAt` (C4), `currentRoomId` khi maintenance (C5), chặn `retired/lost` (C6), có cho recovery về healthy không (C10 — không, UC riêng).

**Ranh giới**: UC-62 CHỈ báo lỗi/chuyển bảo trì. KHÔNG create/xóa/tìm kiếm/phân bổ. KHÔNG recovery (về healthy). KHÔNG migration, KHÔNG execute seed, KHÔNG sửa `create`/module khác.
