# Tasks: Vô hiệu hóa / Kích hoạt lại thiết bị IoT/Camera (IOT-012)

- **Feature ID**: IOT-012
- **Module**: `iot`
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
- **Status**: Draft (chưa code)

> Quy tắc: thực hiện theo thứ tự. Mỗi task ghi file đụng + tiêu chí hoàn thành (DoD) + FR/AC/EC tham chiếu. KHÔNG sửa `IoTDeviceEntity`, KHÔNG migration schema, KHÔNG bảng mới. 2 endpoint không body.

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md cho IOT-012 theo plan (POST disable/enable, @HttpCode(200), logDeviceStatusChange, seed 2 permission). | Toàn bộ file (bản đầu tiên) |

---

## 0. Tiền đề (rà nhanh nếu code đổi)
- [ ] Xác nhận `IoTDeviceStatus` có `DISABLED`/`OFFLINE`; service đã import `IoTDeviceStatus`.
- [ ] Xác nhận controller dùng `JwtAuthGuard` + `MockPermissionsGuard` + `@Permissions(...)` no-op.
- [ ] Xác nhận `IotAuditRepository` chưa có `logDeviceStatusChange`.

---

## 1. Audit repository — `logDeviceStatusChange`
**File**: `src/modules/iot/repositories/iot-audit.repository.ts` (sửa)

- [ ] Thêm `logDeviceStatusChange(entityManager, { userId, deviceId, action, oldStatus, newStatus })`.
- [ ] INSERT `audit_logs` với `action_type = action` (`'disable'`|`'enable'`), `entity_type='iot_devices'`, `severity='info'`, `metadata_json = { changed_fields: { status: { old, new } } }`.
- [ ] Nhận `EntityManager` (chạy chung transaction). Không log secret (SEC-01).

**DoD**: method compile; INSERT đúng cột; không secret.
**Tham chiếu**: FR-014, FR-015, FR-016.

---

## 2. Service — `disable()` + `enable()`
**File**: `src/modules/iot/services/iot-devices.service.ts` (sửa)

- [ ] `async disable(userId, deviceId)`:
  - load device → null → `NotFoundException IOT_DEVICE_NOT_FOUND`. *(EC-002)*
  - `status === DISABLED` → return device (no-op, không transaction/audit). *(FR-003)*
  - transaction: `oldStatus = device.status; device.status = DISABLED;` → save → `logDeviceStatusChange(action='disable', oldStatus, newStatus=DISABLED)` → commit; catch→rollback→throw. *(FR-002, FR-015)*
- [ ] `async enable(userId, deviceId)`:
  - load device → null → `NotFoundException`. *(EC-002)*
  - `status !== DISABLED` → return device (no-op). *(FR-006)*
  - transaction: `device.status = OFFLINE;` → save → `logDeviceStatusChange(action='enable', oldStatus=DISABLED, newStatus=OFFLINE)` → commit. *(FR-005)*
- [ ] Cả 2 chỉ gán `device.status`; KHÔNG chạm `health_status`/`last_seen_at`/`room_id`/`metadata_json`/`device_code`/`device_type`. *(FR-007)*

**DoD**: 2 method đúng nhánh; no-op không mở transaction; chỉ đổi status.
**Tham chiếu**: FR-001..010, EC-002, AC-001..005.

---

## 3. Controller — 2 handler POST
**File**: `src/modules/iot/controllers/iot-devices.controller.ts` (sửa)

- [ ] Import bổ sung `Post` (đã có), `HttpCode` từ `@nestjs/common`.
- [ ] `@Post(':id/disable')` + `@HttpCode(200)` + `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('iot.device.disable')` + `@Param('id', ParseUUIDPipe)`. Không `@Body`/DTO. Gọi `service.disable(userId, id)`, trả `{ success, message:'IoT device disabled successfully', data: toIotDeviceResponse(device) }`.
- [ ] `@Post(':id/enable')` + `@HttpCode(200)` + `@Permissions('iot.device.enable')` tương tự, message `'IoT device enabled successfully'`.
- [ ] `userId = req.user?.userId || req.user?.sub || req.user?.id || null`.

**DoD**: 2 route đăng ký; trả 200 (không 201); sai UUID → 400.
**Tham chiếu**: FR-001/004/011..013, EC-001, AC-006, NC-P2.

---

## 4. Seed 2 permission
**File**: `src/database/seeds/20260615000002-SeedIotDeviceDisableEnablePermissions.ts` (mới)

- [ ] Mirror `SeedIotDeviceUpdatePermission.ts`. INSERT 2 permission:
  - `('iot.device.disable', 'Vô hiệu hóa thiết bị IoT', 'iot', 'device_disable', '<mô tả>', true)`
  - `('iot.device.enable', 'Kích hoạt lại thiết bị IoT', 'iot', 'device_enable', '<mô tả>', true)`
  - mỗi cái `ON CONFLICT (permission_code) DO NOTHING`.
- [ ] Gán `ADMIN`, `MANAGER` qua `role_permissions` (`ON CONFLICT DO NOTHING`).
- [ ] Ghi chú seed-runner chưa wire (team-wide, NC-P1).

**DoD**: file đúng convention, idempotent.
**Tham chiếu**: FR-012, NC-P1.

---

## 5. Tests
**File**: `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung)

- [ ] Thêm `auditRepoMock.logDeviceStatusChange = jest.fn()`.
- [ ] **T1 disable happy** (online→disabled, save+audit 1 lần). *(AC-001)*
- [ ] **T2 disable idempotent** (disabled→no-op, không transaction/audit). *(AC-002)*
- [ ] **T3 disable not found** (null→NotFound). *(EC-002)*
- [ ] **T4 disable không chạm field khác** (health/last_seen/room giữ nguyên). *(AC-005/FR-007)*
- [ ] **T5 disable rollback** (audit reject→rollback). *(FR-015)*
- [ ] **T6 enable happy** (disabled→offline, save+audit). *(AC-003)*
- [ ] **T7 enable no-op khi không disabled** (online→no-op, status vẫn online). *(AC-004)*
- [ ] **T8 enable not found** (null→NotFound). *(EC-002)*
- [ ] Coverage ≥ 80% cho code mới. Không e2e (NC-P3).

**DoD**: 8 test pass.

---

## 6. Final Verification
- [ ] `npm run build` pass.
- [ ] LINT: `npx eslint <từng path file đụng>` (KHÔNG `npm run lint` — có `--fix` sửa toàn repo).
- [ ] `npx jest modules/iot` pass; coverage ≥ 80% code mới.
- [ ] Rà: không đụng entity/schema; không chạm health/last_seen/room/metadata; import `.js`; không log secret.

---

## 7. Traceability nhanh

| Task | FR / AC / EC | NC |
|---|---|---|
| 1 Audit | FR-014/015/016 | — |
| 2 Service | FR-001..010, EC-002, AC-001..005 | — |
| 3 Controller | FR-001/004/011..013, EC-001, AC-006 | NC-P2 |
| 4 Seed | FR-012 | NC-P1 |
| 5 Tests | AC-001..006, EC-002, FR-003/005/006/007/015 | NC-P3 |

---

> Trạng thái: **CHỜ REVIEW** sau khi implement. Dừng chờ Thiếu Chủ.
