# Tasks: Phát hiện thiết bị offline bằng Active Probe (IOT-014)

- **Feature ID**: IOT-014
- **Module**: `iot` (+ `scheduler`, `config`)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
- **Status**: Draft (chưa code)

> Quy tắc: theo thứ tự. Mỗi task: file đụng + DoD + FR/AC/EC. Chỉ đổi `status`. KHÔNG sửa entity/schema. probeTcp **không bao giờ reject**, destroy socket mọi nhánh. Cron CỐ ĐỊNH `CronExpression.EVERY_MINUTE`.

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md IOT-014 theo plan vòng 2 (cron cố định, inject ConfigService, test offline=cổng đóng/timeout=mock). | Toàn bộ file (bản đầu tiên) |

---

## 1. Probe helper — `rtsp-probe.util.ts`
**File**: `src/modules/iot/utils/rtsp-probe.util.ts` (mới)

- [ ] `probeTcp(host, port, timeoutMs): Promise<'online'|'offline'>`.
- [ ] `net.createConnection({host,port})` + `socket.setTimeout(timeoutMs)`; `connect`→online, `timeout`/`error`→offline.
- [ ] `settled` guard; `socket.destroy()` ở MỌI nhánh (finish).
- [ ] Bọc `try/catch` quanh createConnection → throw đồng bộ → `resolve('offline')`. **KHÔNG reject**.

**DoD**: compile; không reject; destroy mọi nhánh.
**Tham chiếu**: FR-003/011, NFR-002.

---

## 2. Audit — mở rộng union
**File**: `src/modules/iot/repositories/iot-audit.repository.ts` (sửa)

- [ ] `logDeviceStatusChange` param `action: 'disable' | 'enable' | 'auto_offline' | 'auto_online'`. Thân INSERT giữ nguyên.

**DoD**: union mở rộng, compile.
**Tham chiếu**: FR-015.

---

## 3. Service — `detectOfflineDevices` + inject ConfigService
**File**: `src/modules/iot/services/iot-devices.service.ts` (sửa)

- [ ] Inject `ConfigService` vào constructor (đọc `RTSP_PROBE_TIMEOUT_MS`, default 3000).
- [ ] `private static readonly PROBE_CONCURRENCY = 10;`
- [ ] `async detectOfflineDevices(actorUserId: string | null)`:
  - `repo.find({ where: { deviceType: IP_CAMERA, status: In([ONLINE, OFFLINE]) } })`.
  - parse host:port (URL→hostname/port||554; regex fallback; ipAddress:554; **validate port 1–65535**; host rỗng/port sai → skip).
  - batch chunk `PROBE_CONCURRENCY` → `Promise.allSettled(probeTcp(...))`.
  - so result vs oldStatus; transition → transaction { `device.status=result`; save; `logDeviceStatusChange(action auto_online/auto_offline, oldStatus, newStatus, userId=actor)` }.
  - return `{ checked, online_count, offline_count, transitions:[{id,from,to}] }`.
- [ ] Chỉ đổi `status`; KHÔNG đụng health/room/metadata/last_seen/code/type.

**DoD**: 2 chiều/idempotent/skip/transaction; chỉ đổi status.
**Tham chiếu**: FR-001..006/010/011/014..016, EC-001..005, AC-001..005.

---

## 4. Controller — `@Post('probe-status')`
**File**: `src/modules/iot/controllers/iot-devices.controller.ts` (sửa)

- [ ] `@Post('probe-status')` `@HttpCode(200)` + `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('iot.device.probe')`, **không** `@Body`, **KHÔNG** gate ENV.
- [ ] `userId` từ JWT; gọi `detectOfflineDevices(userId)`; trả `{ success, message:'Device status probe completed', data }`.
- [ ] Đặt `@Post('probe-status')` (static) trước các `@Post(':id/...')`.

**DoD**: route đăng ký; 200; 403 nếu thiếu quyền.
**Tham chiếu**: FR-009/012/013, AC-006/008, EC-006.

---

## 5. Scheduler — cron
**File**: `src/modules/scheduler/scheduler.service.ts` + `scheduler.module.ts` (sửa)

- [ ] `scheduler.module.ts`: `imports: [ScheduleModule.forRoot(), ConfigModule, IotModule]` (verify không circular).
- [ ] `scheduler.service.ts`: inject `IotDevicesService`; constructor đọc `deviceOfflineDetectEnabled = configService.get('DEVICE_OFFLINE_DETECT_ENABLED', true)`.
- [ ] `@Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })` `detectOfflineDevices()`: gate `if (!schedulerEnabled || !deviceOfflineDetectEnabled) return;` → gọi `iotDevicesService.detectOfflineDevices(null)` → log tóm tắt.

**DoD**: cron đăng ký; gate đúng; delegate; build không circular.
**Tham chiếu**: FR-008/014, AC-007, NC-5.

---

## 6. ENV (Joi)
**File**: `src/config/env.validation.ts` (sửa)

- [ ] Thêm section "Device Probe": `DEVICE_OFFLINE_DETECT_ENABLED: Joi.boolean().default(true)`, `RTSP_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(3000)`. (KHÔNG CRON.)

**DoD**: 2 ENV, build pass.

---

## 7. Seed `iot.device.probe`
**File**: `src/database/seeds/20260615000004-SeedIotDeviceProbePermission.ts` (mới)

- [ ] Mirror seed hiện có: INSERT `('iot.device.probe','Probe trạng thái online/offline thiết bị IoT','iot','device_probe','...',true)` + ON CONFLICT DO NOTHING; gán ADMIN/MANAGER.

**DoD**: file đúng convention, idempotent.

---

## 8. Tests
**File**: `src/modules/iot/utils/rtsp-probe.util.spec.ts` (mới) + bổ sung `iot-devices.service.spec.ts`

- [ ] **probe online**: `net.createServer` listen cổng ngẫu nhiên → probeTcp 'online'.
- [ ] **probe offline (refuse)**: cổng đóng → 'offline'.
- [ ] **probe timeout**: mock socket (giả emit 'timeout') → 'offline', assert `destroy()` gọi. (KHÔNG connect mạng thật.)
- [ ] Service spec: thêm mock `ConfigService` (get → 3000) + mock repo `find` + jest.mock probeTcp.
- [ ] **online→offline**: transaction + audit 'auto_offline'; transitions {from online,to offline}.
- [ ] **offline→online**: audit 'auto_online'.
- [ ] **idempotent**: result===old → không transaction/audit/transition.
- [ ] **skip disabled/no-address**: where `In([online,offline])`; camera thiếu địa chỉ không tính checked.
- [ ] **resilience**: 1 probe offline (lỗi) không hỏng lượt; counts đúng.
- [ ] Coverage ≥ 80% code mới. Không e2e.

**DoD**: tất cả test pass.

---

## 9. Final Verification
- [ ] `npm run build` pass (verify không circular dep).
- [ ] LINT: `npx eslint <từng path>` (KHÔNG `npm run lint`).
- [ ] `npx jest modules/iot` (+ scheduler nếu có test) pass; coverage ≥ 80% code mới.
- [ ] Rà: chỉ đổi status; probe never-reject + destroy; chỉ probe device trong DB; import `.js`; không log secret.

---

## 10. Traceability

| Task | FR / AC / EC | NC |
|---|---|---|
| 1 Probe helper | FR-003/011, NFR-002 | NC-P4 |
| 2 Audit | FR-015 | — |
| 3 Service | FR-001..006/010/014..016, EC-001..005, AC-001..005 | NC-P1 |
| 4 Controller | FR-009/012/013, AC-006/008 | — |
| 5 Scheduler | FR-008/014, AC-007 | NC-1/3/5 |
| 6 ENV | FR-003/008 | NC-1 |
| 7 Seed | FR-013 | NC-P2 |
| 8 Tests | AC-001..008, EC-001..005 | NC-P4 |

---

> Trạng thái: **CHỜ REVIEW** sau implement. Dừng chờ Thiếu Chủ.
