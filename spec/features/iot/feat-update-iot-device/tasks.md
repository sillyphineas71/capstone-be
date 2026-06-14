# Tasks: Cập nhật thông tin thiết bị IoT/Camera (IOT-011)

- **Feature ID**: IOT-011
- **Module**: `iot`
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
- **Status**: Draft (chưa code)

> Quy tắc: thực hiện theo thứ tự. Mỗi task ghi rõ file đụng + tiêu chí hoàn thành (DoD) + FR/AC/EC tham chiếu. KHÔNG sửa `IoTDeviceEntity`, KHÔNG migration schema, KHÔNG bảng mới.

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md cho IOT-011 theo plan đã chốt NC-P1..P4. | Toàn bộ file (bản đầu tiên) |

---

## 0. Tiền đề (đã xác minh ở bước /plan — chỉ rà lại nếu code đổi)
- [ ] Xác nhận `IoTDeviceEntity` còn nguyên field `deviceName/ipAddress/macAddress/networkIdentifier` + `@UpdateDateColumn`.
- [ ] Xác nhận controller `iot-devices.controller.ts` vẫn dùng `JwtAuthGuard` + `MockPermissionsGuard` + `@Permissions(...)` no-op.
- [ ] Xác nhận `IotAuditRepository` chưa có `logDeviceUpdate`; pattern insert `audit_logs` qua `EntityManager.query`.
- [ ] Xác nhận KHÔNG có global `ValidationPipe` (main.ts) → dùng pipe route-level.

---

## 1. DTO — `UpdateIotDeviceDto`
**File**: `src/modules/iot/dto/update-iot-device.dto.ts` (mới)

- [ ] Tạo class `UpdateIotDeviceDto` với 4 field allowlist, map snake↔camel bằng `@Expose({ name })` (bám [create-iot-device.dto.ts](../../../../src/modules/iot/dto/create-iot-device.dto.ts)).
- [ ] `deviceName`: `@ValidateIf((o) => o.deviceName !== undefined)` + `@IsString` + `@IsNotEmpty` + `@MaxLength(150)` — **KHÔNG** `@IsOptional` (để `null` → 400).
- [ ] `ipAddress`: `@IsOptional` + `@ValidateIf((_, v) => v !== null)` + `@IsIP`; type `string | null`.
- [ ] `macAddress`: `@IsOptional` + `@Transform(v => v===null ? null : normalizeMacAddress(v))` + `@ValidateIf((_, v) => v !== null)` + `@IsMACAddress`; type `string | null`.
- [ ] `networkIdentifier`: `@IsOptional` + `@ValidateIf((_, v) => v !== null)` + `@IsString` + `@MaxLength(150)`; type `string | null`.
- [ ] Import `normalizeMacAddress` từ `../../../common/utils/mac.util.js` (đuôi `.js`, nodenext).

**DoD**: DTO compile, đúng 4 field; `device_name: null` không hợp lệ, 3 field kia chấp nhận null.
**Tham chiếu**: FR-002, FR-003, FR-009, EC-004..007, NC-P3.

---

## 2. Audit repository — `logDeviceUpdate`
**File**: `src/modules/iot/repositories/iot-audit.repository.ts` (sửa)

- [ ] Thêm method `logDeviceUpdate(entityManager, { userId, deviceId, changes })`.
- [ ] INSERT `audit_logs` với `action_type='update'`, `entity_type='iot_devices'`, `severity='info'`, `metadata_json = { changed_fields: changes }` (qua `$3::jsonb`).
- [ ] Nhận `EntityManager` để chạy chung transaction (mirror `logAssignRoom`).
- [ ] KHÔNG đưa `metadata_json` thiết bị vào log; 4 field allowlist không chứa secret (SEC-01).

**DoD**: method compile, INSERT đúng cột; không log secret.
**Tham chiếu**: FR-015, FR-016, FR-017.

---

## 3. Service — `IotDevicesService.update()`
**File**: `src/modules/iot/services/iot-devices.service.ts` (sửa)

- [ ] Thêm `async update(userId: string | null, deviceId: string, dto: UpdateIotDeviceDto): Promise<IoTDeviceEntity>`.
- [ ] Import `Not` từ `typeorm`; import `UpdateIotDeviceDto`.
- [ ] **B1**: load device theo `id`; không có → `NotFoundException { code:'IOT_DEVICE_NOT_FOUND' }`. *(EC-002/404)*
- [ ] **B2**: build `updates` chỉ gồm field `dto[f] !== undefined` (4 field); rỗng → `BadRequestException { code:'NO_UPDATABLE_FIELDS' }`. *(EC-003/400)*
- [ ] **B3**: nếu `macAddress` có trong updates, khác null, khác giá trị hiện tại → `findOne({ where: { macAddress, id: Not(deviceId) } })`; trùng → `ConflictException { code:'MAC_ADDRESS_EXISTS' }`. *(FR-007/409)*
- [ ] **B4 (idempotent)**: so sánh từng field updates với giá trị hiện tại; nếu không field nào đổi thực → return device (không transaction/save/audit). *(FR-005/200)*
- [ ] **B5 (transaction)**: gán field đã đổi → `manager.save(IoTDeviceEntity, device)` → `iotAuditRepository.logDeviceUpdate(manager, { userId, deviceId, changes })` → commit; catch → rollback → throw. *(FR-016)*
- [ ] Đảm bảo KHÔNG gán `status/healthStatus/lastSeenAt` (không nằm trong updates). *(FR-010)*

**DoD**: 5 nhánh xử lý đúng; transaction + audit chỉ chạy khi có thay đổi thực.
**Tham chiếu**: FR-004..010, FR-015..017, EC-002/003, AC-001/002/003/006.

---

## 4. Controller — `@Patch(':id')`
**File**: `src/modules/iot/controllers/iot-devices.controller.ts` (sửa)

- [ ] Thêm handler `@Patch(':id')` mirror `assignRoom`.
- [ ] `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('iot.device.update')` (dot-notation).
- [ ] `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` — **route-level**, forbidNonWhitelisted=true.
- [ ] `@Param('id', ParseUUIDPipe) id` *(EC-001/400)*; `@Body() dto: UpdateIotDeviceDto`.
- [ ] Lấy `userId = req.user?.userId || req.user?.sub || req.user?.id || null`.
- [ ] Gọi `service.update(userId, id, dto)`; trả `{ success:true, message:'IoT device updated successfully', data: toIotDeviceResponse(device) }`.

**DoD**: route đăng ký đúng; field ngoài allowlist → 400; sai UUID → 400.
**Tham chiếu**: FR-001, FR-003, FR-012..014, EC-001/004, AC-004/005, NC-P2.

---

## 5. Seed permission `iot.device.update`
**File**: `src/database/seeds/<timestamp>-SeedIotDeviceUpdatePermission.ts` (mới)

- [ ] Mirror [SeedRemoveParticipantPermissions.ts](../../../../src/database/seeds/20260611000001-SeedRemoveParticipantPermissions.ts): `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)` với `('iot.device.update', 'Cập nhật thông tin thiết bị IoT', 'iot', 'device_update', '<mô tả>', true)` + `ON CONFLICT (permission_code) DO NOTHING`.
- [ ] Gán cho role `ADMIN`, `MANAGER` qua `role_permissions` (`ON CONFLICT DO NOTHING`).
- [ ] Ghi chú trong file: **seed-runner chưa wire là vấn đề team-wide, ngoài phạm vi IOT-011** (NC-P1).

**DoD**: file seed đúng convention, idempotent (`ON CONFLICT DO NOTHING`).
**Tham chiếu**: FR-013, NC-P1.

---

## 6. Tests
**File**: `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung) + `src/modules/iot/dto/update-iot-device.dto.spec.ts` (mới)

- [ ] Bổ sung `auditRepoMock.logDeviceUpdate = jest.fn()` vào mock hiện có.
- [ ] **T1 Happy**: đổi `deviceName`+`ipAddress` → `save` 1 lần, `logDeviceUpdate` 1 lần, trả device mới. *(AC-001)*
- [ ] **T2 Idempotent**: gửi giá trị trùng hiện tại → KHÔNG `createQueryRunner`/`save`/`logDeviceUpdate`, trả device cũ. *(AC-002/FR-005)*
- [ ] **T3 MAC trùng**: `findOne` (exclude self) trả device khác → `ConflictException` MAC_ADDRESS_EXISTS. *(AC-003/FR-007)*
- [ ] **T4 Not found**: device chính null → `NotFoundException` IOT_DEVICE_NOT_FOUND. *(EC-002)*
- [ ] **T5 Body rỗng**: dto không field allowlist → `BadRequestException` NO_UPDATABLE_FIELDS. *(EC-003)*
- [ ] **T6 Set null**: `ipAddress: null` → device.ipAddress=null, `save` gọi. *(AC-006/FR-009)*
- [ ] **T7 Không đụng status**: status/healthStatus/lastSeenAt giữ nguyên sau update. *(FR-010)*
- [ ] **T8 DTO transform**: validate `UpdateIotDeviceDto` — map snake→camel, phân biệt undefined vs null, `device_name: null` → invalid (400). *(FR-003/FR-009/EC-007/NC-P3)*
- [ ] Coverage ≥ 80% cho code mới (ENG-01). Không e2e (NC-P4).

**DoD**: 8 nhóm test pass.

---

## 7. Final Verification
- [ ] `npm run lint` pass.
- [ ] `npm run test` pass (kèm coverage ≥ 80% cho file mới).
- [ ] `npm run build` pass (không lỗi type).
- [ ] Rà soát: KHÔNG đụng entity/schema/baseline; KHÔNG log secret; import `.js`; response snake_case + mask metadata.
- [ ] Cập nhật checkbox file này.

---

## 8. Tham chiếu nhanh (Traceability)

| Task | FR / AC / EC | NC |
|---|---|---|
| 1 DTO | FR-002/003/009, EC-004..007 | NC-P3 |
| 2 Audit | FR-015/016/017 | — |
| 3 Service | FR-004..010, FR-016, EC-002/003, AC-001/002/003/006 | — |
| 4 Controller | FR-001/003/012..014, EC-001/004, AC-004/005 | NC-P2 |
| 5 Seed | FR-013 | NC-P1 |
| 6 Tests | AC-001..006, EC-002/003/007, FR-005/007/009/010 | NC-P4 |

---

> Trạng thái: **CHỜ REVIEW**. Đây là tasks — chưa code. Dừng chờ Thiếu Chủ review.
