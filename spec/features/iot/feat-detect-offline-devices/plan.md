---
name: feat-detect-offline-devices-plan
description: Kế hoạch hiện thực IOT-014 — active TCP probe RTSP (cron + POST /iot-devices/probe-status), maintain online↔offline cho ip_camera.
category: iot
---

# Implementation Plan: Phát hiện thiết bị offline bằng Active Probe (IOT-014)

- **Feature ID**: IOT-014
- **Module**: `iot` (+ `scheduler` cho cron, `config` cho ENV)
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md IOT-014: probe helper (net), service.detectOfflineDevices (batch cap 10), SchedulerService @Cron delegate, controller probe-status, ENV Joi, seed iot.device.probe, mở rộng audit union. Xác minh code thật (cron dùng CronExpression constants, SCHEDULER_*_CRON env chưa wire). | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt vòng 2: cron CỐ ĐỊNH `CronExpression.EVERY_MINUTE` (bỏ env CRON); inject ConfigService vào IotDevicesService (RTSP_PROBE_TIMEOUT_MS); test offline=cổng đóng, timeout=mock socket; probeTcp bọc try/catch never-reject; parse validate port 1–65535. | §3, §4.1, §6, §8, §11, §13 |

---

## 1. Technical Context

- **Framework**: NestJS 11 + PostgreSQL + TypeORM + `@nestjs/schedule`. nodenext → import `.js`.
- **Trạng thái (đã xác minh)**:
  - [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts): có create/update/disable/enable/findAll/findOne/checkAvailability. Nhánh `IP_CAMERA` của `checkAvailability` (~L775+) chỉ kiểm config (`runtime_verified=false`) — gap IOT-014 lấp. `configureRtsp` build `stream_url = rtsp://host:port/path` (L669, không credential). Dùng `this.dataSource`.
  - [iot-audit.repository.ts:81](../../../../src/modules/iot/repositories/iot-audit.repository.ts): `logDeviceStatusChange({ action: 'disable' | 'enable', ... })` → mở rộng union.
  - [scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts): cron gom tại đây; `@Cron` dùng `CronExpression.*` constants (các env `SCHEDULER_*_CRON` chỉ khai báo Joi, không wire vào decorator). IOT-014 **theo đúng convention này** → `@Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })` (cron CỐ ĐỊNH, đảo NC-1; KHÔNG env CRON).
  - [scheduler.module.ts](../../../../src/modules/scheduler/scheduler.module.ts): `ScheduleModule.forRoot()` + `ConfigModule`. Cần thêm `imports: [IotModule]` để inject `IotDevicesService`. **VERIFY: không circular** — SchedulerModule chỉ được `app.module` import; `IotModule`→`AuthModule` không import ngược SchedulerModule.
  - [env.validation.ts](../../../../src/config/env.validation.ts): Joi object, thêm ENV mới ở section phù hợp.
  - [iot.module.ts](../../../../src/modules/iot/iot.module.ts): **ĐÃ** `exports: [TypeOrmModule, IotDevicesService, IotDeviceEventsService]` (L41) → SchedulerModule dùng được ngay, không cần sửa.
- **ARCH-02**: probe inline (chấp nhận scale capstone); note chuyển queue nếu fleet lớn.
- KHÔNG sửa entity/schema; chỉ đổi cột `status`.

---

## 2. Danh sách thay đổi (file)

| Loại | File | Nội dung |
|---|---|---|
| **Mới** | `src/modules/iot/utils/rtsp-probe.util.ts` | `probeTcp(host, port, timeoutMs): Promise<'online'\|'offline'>` (net, destroy mọi nhánh, không reject). |
| **Sửa** | `src/modules/iot/services/iot-devices.service.ts` | Thêm `detectOfflineDevices(actorUserId)` + helper parse host:port + `PROBE_CONCURRENCY=10`. |
| **Sửa** | `src/modules/iot/repositories/iot-audit.repository.ts` | Mở rộng `logDeviceStatusChange` union thêm `'auto_offline'\|'auto_online'`. |
| **Sửa** | `src/modules/iot/controllers/iot-devices.controller.ts` | Thêm `@Post('probe-status')` `@HttpCode(200)`. |
| **Sửa** | `src/modules/scheduler/scheduler.service.ts` | Thêm `@Cron(...)` `device-offline-detect` delegate `detectOfflineDevices(null)`. |
| **Sửa** | `src/modules/scheduler/scheduler.module.ts` | `imports: [..., IotModule]`. |
| **Sửa** | `src/config/env.validation.ts` | +2 ENV (Joi): `DEVICE_OFFLINE_DETECT_ENABLED`, `RTSP_PROBE_TIMEOUT_MS`. |
| **Mới (seed)** | `src/database/seeds/<ts>-SeedIotDeviceProbePermission.ts` | `iot.device.probe` (ADMIN/MANAGER). |
| **Mới (test)** | `utils/rtsp-probe.util.spec.ts` + bổ sung `iot-devices.service.spec.ts` | probe helper + detectOfflineDevices. |

---

## 3. Probe helper — `rtsp-probe.util.ts` (phần rủi ro nhất)

```ts
import * as net from 'net';

export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<'online' | 'offline'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'online' | 'offline', socket: net.Socket) => {
      if (settled) return;
      settled = true;
      socket.destroy(); // PHẢI destroy ở mọi nhánh — tránh rò file descriptor
      resolve(result);
    };

    try {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish('online', socket));
      socket.once('timeout', () => finish('offline', socket));
      socket.once('error', () => finish('offline', socket));
    } catch {
      // createConnection ném đồng bộ (vd host/port không hợp lệ) → coi offline, KHÔNG reject
      if (!settled) {
        settled = true;
        resolve('offline');
      }
    }
  });
}
```

- **KHÔNG BAO GIỜ reject**: mọi lỗi → `'offline'` (đảm bảo 1 camera không làm hỏng cả lượt — FR-011/NFR-002).
- `settled` guard tránh resolve 2 lần (vd timeout sau error).
- `socket.destroy()` ở `finish` cho cả 3 nhánh connect/timeout/error.
- KHÔNG gửi/đọc data (chỉ cần mở được TCP). KHÔNG dùng lib ngoài.

---

## 4. Service — `detectOfflineDevices(actorUserId)`

Hằng số: `private static readonly PROBE_CONCURRENCY = 10;`. `RTSP_PROBE_TIMEOUT_MS` đọc qua **ConfigService** (inject vào constructor `IotDevicesService` — chốt NC-P1), `configService.get<number>('RTSP_PROBE_TIMEOUT_MS', 3000)`.

```text
1. cameras = repo.find({ where: { deviceType: 'ip_camera', status: In(['online','offline']) } }).
2. targets = []  // {device, host, port}
   for each camera: parse host:port (mục 4.1); nếu không có địa chỉ → skip (không thêm vào targets).
3. results = []  // {device, oldStatus, result}
   chunk targets thành batch PROBE_CONCURRENCY (10):
     for each batch: await Promise.allSettled(batch.map(t => probeTcp(t.host,t.port,timeout)
        .then(r => results.push({device:t.device, oldStatus:t.device.status, result:r}))))
   (probeTcp không reject nên allSettled luôn fulfilled; dùng allSettled cho an toàn tuyệt đối.)
4. transitions = []; online_count = 0; offline_count = 0;
   for each r in results:
     r.result==='online' ? online_count++ : offline_count++;
     if (r.result !== r.oldStatus) {
        transaction { device.status=r.result; save; logDeviceStatusChange(action: r.result==='online'?'auto_online':'auto_offline', oldStatus:r.oldStatus, newStatus:r.result, userId:actorUserId) }
        transitions.push({ id:r.device.id, from:r.oldStatus, to:r.result })
     }
5. return { checked: targets.length, online_count, offline_count, transitions }.
```

### 4.1 Parse host:port
```text
- nếu device.streamUrl: thử new URL(streamUrl) → hostname + (port || 554).
  (URL hỗ trợ scheme rtsp: → .hostname, .port). Nếu parse fail → regex /^rtsp:\/\/([^/:]+)(?::(\d+))?/i.
- else nếu device.ipAddress: host=ipAddress, port=554.
- else: null (skip).
- VALIDATE port: parse số nguyên; nếu NaN hoặc < 1 hoặc > 65535 → coi như không có địa chỉ hợp lệ → SKIP (FR-002).
- host rỗng/null → SKIP.
```

- **Transaction từng transition** (không gộp cả lượt) → 1 transition lỗi DB chỉ rollback chính nó (FR-016/EC-004); các camera khác vẫn xử lý.
- Chỉ gán `device.status`. KHÔNG đụng field khác (FR-006).

---

## 5. Audit — mở rộng union

```ts
action: 'disable' | 'enable' | 'auto_offline' | 'auto_online';
```
Phần thân INSERT giữ nguyên (`action_type = params.action`). Không secret.

---

## 6. SchedulerService — cron

```ts
@Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })
async detectOfflineDevices(): Promise<void> {
  if (!this.schedulerEnabled || !this.deviceOfflineDetectEnabled) return;
  const r = await this.iotDevicesService.detectOfflineDevices(null);
  this.logger.log(`[Scheduler] device-offline-detect: checked=${r.checked} online=${r.online_count} offline=${r.offline_count} transitions=${r.transitions.length}`);
}
```
- Constructor đọc `deviceOfflineDetectEnabled = configService.get('DEVICE_OFFLINE_DETECT_ENABLED', true)`.
- Inject `IotDevicesService` (SchedulerModule import IotModule).
- **Cron CỐ ĐỊNH** `CronExpression.EVERY_MINUTE` (đảo NC-1) — đồng bộ cách `@Cron` hiện dùng constant; KHÔNG đọc env cron.

---

## 7. Controller — endpoint manual

```ts
@Post('probe-status')
@HttpCode(200)
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.probe')
async probeStatus(@Req() req: any) {
  const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
  const data = await this.iotDevicesService.detectOfflineDevices(userId);
  return { success: true, message: 'Device status probe completed', data };
}
```
- **KHÔNG gate** bằng ENV (admin gọi là chạy).
- Không `@Body`. ⚠️ **Route order**: `@Post('probe-status')` (static) phải khai báo TRƯỚC `@Post(':id/...')`? Hiện chỉ có `@Post(':id/assign-room')`/`disable`/`enable` (2 segment) — `probe-status` (1 segment) không trùng `@Post()` (create, 0 segment con). An toàn, nhưng đặt `probe-status` trước cho rõ ràng.

---

## 8. ENV (Joi) — thêm section "Device Probe"

```ts
DEVICE_OFFLINE_DETECT_ENABLED: Joi.boolean().default(true),
RTSP_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(3000),
```
> Bỏ `DEVICE_OFFLINE_DETECT_CRON` (cron cố định `EVERY_MINUTE`).

---

## 9. Seed `iot.device.probe`

File `src/database/seeds/<ts>-SeedIotDeviceProbePermission.ts` mirror seed hiện có: INSERT `('iot.device.probe','Probe trạng thái online/offline thiết bị IoT','iot','device_probe','...',true)` + ON CONFLICT DO NOTHING; gán ADMIN/MANAGER. Ghi chú seed-runner team-wide (NC-P2).

---

## 10. Error mapping

| Tình huống | Cơ chế | HTTP/Hệ quả |
|---|---|---|
| Endpoint thiếu JWT | JwtAuthGuard | 401 |
| Thiếu quyền | PermissionsGuard | 403 |
| Probe 1 camera timeout/error | probeTcp → 'offline' | không lỗi, tiếp tục |
| Lỗi DB 1 transition | rollback transition đó | camera khác vẫn chạy |
| Camera thiếu địa chỉ | skip | không tính checked |

---

## 11. Testing (ENG-01 ≥ 80%)

### 11.1 `rtsp-probe.util.spec.ts`
- **online**: server `net.createServer` listen cổng ngẫu nhiên → probeTcp resolve 'online'.
- **offline (refuse)**: cổng đóng (không listen) → 'offline'.
- **timeout**: host không route (vd `10.255.255.1`) hoặc mock setTimeout → 'offline'. (Có thể dùng cổng đóng cho deterministic; timeout case dùng timeout nhỏ.)
- Khẳng định socket được destroy (spy `net.createConnection` trả socket giả với `destroy` jest.fn → kiểm gọi).

### 11.2 `detectOfflineDevices` (mock repo + mock probe)
- Mock `dataSource.getRepository(...).find` trả danh sách; mock `probeTcp` (jest.mock util) theo từng host.
- **online→offline**: oldStatus online, probe offline → transaction + audit 'auto_offline'; transitions chứa {from:online,to:offline}.
- **offline→online**: audit 'auto_online'.
- **idempotent**: result === oldStatus → KHÔNG transaction/audit, không transitions.
- **skip disabled/maintenance**: find query `status In(['online','offline'])` → không trả disabled (kiểm where), checked không gồm.
- **skip no-address**: camera thiếu streamUrl+ipAddress → không probe, checked không tính.
- **lỗi 1 cái không hỏng lượt**: 1 probe 'offline' (lỗi), các camera khác vẫn xử lý, kết quả tổng đúng.
- **counts**: online_count/offline_count/checked đúng.

### 11.3 Endpoint + cron gate
- Endpoint gọi `detectOfflineDevices(userId)` (service spec/controller-level nhẹ nếu theo chuẩn module).
- Cron: gate `SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED` (false → không gọi service).

- Coverage ≥ 80% code mới (util + detectOfflineDevices). Không e2e.

---

## 12. Ràng buộc & ngoài phạm vi

- KHÔNG sửa entity/schema (DATA-01). Chỉ đổi `status`.
- probeTcp không reject; destroy socket mọi nhánh (NFR-002, không treo event-loop, không rò FD).
- Chỉ probe device trong `iot_devices` (host:port từ DB), KHÔNG nhận địa chỉ từ input (NFR-003 SEC).
- Idempotent; inline (ARCH-02, note queue cho fleet lớn). Import `.js`; không log secret.
- v1 không anti-flap/debounce.

---

## 13. Quyết định đã chốt (vòng 2) + ghi chú còn lại

| # | Chốt |
|---|---|
| **NC-P1 → chốt** | **Inject `ConfigService`** vào `IotDevicesService` constructor để đọc `RTSP_PROBE_TIMEOUT_MS` (default 3000). PHẢI cập nhật test providers (thêm mock ConfigService). |
| **NC-P3 → chốt (đảo)** | Cron **CỐ ĐỊNH** `CronExpression.EVERY_MINUTE`; **bỏ** env `DEVICE_OFFLINE_DETECT_CRON`. |
| **NC-P4 → chốt** | Test: **online** = `net.createServer` listen cổng ngẫu nhiên; **offline** = cổng đóng (refuse); **timeout** = mock socket (giả emit 'timeout') + assert `destroy()` được gọi. KHÔNG connect mạng thật/treo CI. |
| **NC-P2 (giữ)** | Seed-runner chưa wire = team-wide (như IOT-011/012/013), ngoài phạm vi. |

---

## 14. Definition of Done

```text
[ ] rtsp-probe.util: probeTcp net, destroy mọi nhánh, không reject
[ ] service.detectOfflineDevices: select ip_camera online/offline, parse host:port (fallback ip:554, skip no-addr), batch cap 10, transition→transaction+audit, trả {checked,online_count,offline_count,transitions}
[ ] audit union +auto_offline/auto_online
[ ] SchedulerService @Cron(CronExpression.EVERY_MINUTE) device-offline-detect gate SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED → detectOfflineDevices(null); SchedulerModule import IotModule (verify không circular)
[ ] controller @Post('probe-status') @HttpCode(200) @Permissions('iot.device.probe'), không gate, không body
[ ] IotDevicesService inject ConfigService (RTSP_PROBE_TIMEOUT_MS)
[ ] ENV Joi: DEVICE_OFFLINE_DETECT_ENABLED, RTSP_PROBE_TIMEOUT_MS (KHÔNG CRON)
[ ] seed iot.device.probe (ADMIN/MANAGER)
[ ] test probe-helper + detectOfflineDevices (2 chiều/idempotent/skip/resilience); coverage ≥80% code mới
[ ] chỉ đổi status; không sửa entity/schema; không log secret; import .js
[ ] build/lint(per-file)/test xanh
```

---

> Trạng thái: **CHỜ REVIEW**. Đây là plan — chưa có tasks.md, chưa code. Dừng chờ Thiếu Chủ review.
