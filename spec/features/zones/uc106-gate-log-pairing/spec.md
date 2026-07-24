# GAP-001 — UC-106 (Zones): Ghép cặp vào–ra + tính thời gian trong khuôn viên

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec GAP-001 (UC-106, FT-20 SCMPTS): ghép cặp `enter`/`leave` trong `gate_access_logs`, ghi `paired_log_id` + `duration_seconds`. 7 quyết định nền đã chốt (§8). ⚠ UC ĐẦU TIÊN: chạy bằng **cron** (không HTTP), tạo **migration schema thật** (partial unique index — ngoại lệ có chủ đích), ghi dữ liệu **tự động**, đọc **bảng rỗng** (writer UC-105 chưa xây). Nhiều điểm crux còn mở ở §9 — chưa chốt tiêu chí ghép cặp/cửa sổ thời gian/xử thiếu cặp. | Toàn bộ |
| 2026-07-23 | Thiếu Chủ chốt OQ-1→OQ-11 (§9 → ĐÃ CHỐT). Tiêu chí: user_id + LIFO + không bắt cùng zone + xử `leave` theo accessTime tăng dần; cửa sổ 24h qua env `GATE_PAIRING_WINDOW_HOURS`; hai chiều `paired_log_id` + `duration_seconds` **cả hai bản**; cron EVERY_5_MINUTES lô 300 env-OFF; tách `GateLogPairingService`. **3 điểm KHÁC đề xuất ban đầu của agent**: (i) OQ-3 dùng **cửa sổ quét** (`now - window - buffer`) thay vì cờ/chấp nhận quét lại — bỏ hẳn ý cờ `metadata_json`; (ii) OQ-4 ghi `duration_seconds` ở **cả hai** bản (agent đề xuất leave-only); (iii) OQ-7 giữ (c) nhưng diễn đạt lại: "xe **đã đăng ký** ghép qua `user_id` bình thường; chỉ bản `user_id` NULL không ghép" (không phải bỏ hẳn nghiệp vụ xe). Cập nhật §2/§3/§4/§5. | §2, §3, §4, §5, §9 |

> **SPEC-ONLY.** Chưa plan/tasks/code. RECON đối chiếu độc lập trên code thật (§0). 7 quyết định nền đã chốt ở §8 — **KHÔNG mở lại**. Nhưng phần lớn **thuật toán** (tiêu chí ghép, cửa sổ, thiếu cặp, duration) **CÒN MỞ** ở §9 — spec này mô tả **khung cơ học** (khoá `FOR UPDATE`, safety-net unique index, idempotency) đã chốt, để trống chỗ nghiệp vụ chờ Thiếu Chủ.
> ⚠⚠ **BỐN ĐIỂM KHÁC 8 UC TRƯỚC** (§2): cron thay HTTP · ghi tự động · migration schema thật · bảng rỗng (không verify được bằng dữ liệu thật, toàn bộ test là mock — residual §10).

---

## 0. RECON findings (đã đọc CODE THẬT — đã xác minh)

### 0.A. Cơ chế cron ⭐ ([scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts), [scheduler.module.ts](../../../../src/modules/scheduler/scheduler.module.ts))
- Repo dùng **`@nestjs/schedule`** — `ScheduleModule.forRoot()` ([scheduler.module.ts:25](../../../../src/modules/scheduler/scheduler.module.ts)), decorator `@Cron(CronExpression..., { name })` ([scheduler.service.ts:89,105,124,138,167,190,212,238,253](../../../../src/modules/scheduler/scheduler.service.ts)). KHÔNG BullMQ.
- **Mọi cron job hiện có** (9 job, tất cả trong `SchedulerService`):

  | Job | Chu kỳ | Env gate |
  | :--- | :--- | :--- |
  | `face-sync` | EVERY_MINUTE | `SCHEDULER_ENABLED && FACE_SYNC_ENABLED` |
  | `face-reconcile` | EVERY_5_MINUTES | `FACE_SYNC_ENABLED` |
  | `device-offline-detect` | EVERY_MINUTE | `DEVICE_OFFLINE_DETECT_ENABLED` |
  | `no-show-check` | EVERY_5_MINUTES | `SCHEDULER_NO_SHOW_CHECK_ENABLED` |
  | `auto-release` | EVERY_5_MINUTES | `SCHEDULER_AUTO_RELEASE_ENABLED` |
  | `early-vacancy` | EVERY_5_MINUTES | `SCHEDULER_EARLY_VACANCY_ENABLED` |
  | `ivss-sync` | EVERY_MINUTE | `SCHEDULER_IVSS_SYNC_ENABLED` |
  | `notification-reminder` | EVERY_HOUR | `SCHEDULER_NOTIFICATION_REMINDER_ENABLED` |
  | `checkin-alert` | EVERY_MINUTE | `SCHEDULER_ENABLED` |

- **Bật/tắt qua env**: có, `this.configService.get<boolean>('SCHEDULER_*_ENABLED', false)` ([:47-78](../../../../src/modules/scheduler/scheduler.service.ts)); hầu hết default **OFF**. Mẫu gate ở đầu mỗi job: `if (!this.schedulerEnabled || !this.xEnabled) return;`.
- **Xử lý lỗi**: mỗi job bọc `try/catch`, log `this.logger.error(...)` — **KHÔNG ném ra cron** ([:98-102,144-158](../../../../src/modules/scheduler/scheduler.service.ts)) (bài học ARCH-02: ném ra cron làm chết scheduler).
- **Chồng lấn**: **KHÔNG có** cơ chế chống overlap tường minh (không lock, không `@Cron` skip-if-running). Job phải tự idempotent + đủ nhanh trong chu kỳ. ⇒ UC-106 phải tự chống chồng lấn (safety-net unique index + `FOR UPDATE`).
- **`background_jobs`**: `SchedulerService` **KHÔNG** ghi bảng `background_jobs` (grep `src/modules/scheduler` = 0 match). Các job chỉ `logger.log` summary. ⇒ UC-106 **không bắt buộc** ghi `background_jobs` (theo tiền lệ) — xem OQ-6.
- **Wiring**: `SchedulerModule` import các domain module (`AttendanceModule`, `IotModule`, `RoomsModule`, `FaceAccessModule`, `IvssModule`) rồi `SchedulerService` inject service của chúng ([scheduler.module.ts:27-31](../../../../src/modules/scheduler/scheduler.module.ts), [scheduler.service.ts:37-46](../../../../src/modules/scheduler/scheduler.service.ts)). ⇒ UC-106 cron cần `SchedulerModule` import **`ZonesModule`** + `SchedulerService` inject service ghép cặp — **thay đổi `scheduler.service.ts` + `scheduler.module.ts`** (net-new dependency `scheduler → zones`, xem §4/OQ-9).

### 0.B. Tiền lệ ghép cặp check-in/check-out ⭐ ([face-attendance.service.ts:155-220](../../../../src/modules/face-access/services/face-attendance.service.ts))
- `checkOut(meeting, userId, verifyTime, ...)`: ghép theo **`meeting_id + user_id`** — 1 `attendance_records` cho mỗi cặp meeting+user; set `check_out_time` bằng `UPDATE`. **KHÔNG** phải mô hình 2-dòng-log-tự-trỏ như gate.
- **Cửa sổ thời gian**: dựa `effectiveEnd = actual_end_time ?? end_time` **+ grace `FACE_SYNC_GRACE_MINUTES`** ([:169-176](../../../../src/modules/face-access/services/face-attendance.service.ts)) — quá grace sau giờ họp kết thúc thì skip. Đây là cửa sổ **theo meeting**, gate KHÔNG có meeting.
- **Idempotent** ([:196-202](../../../../src/modules/face-access/services/face-attendance.service.ts)): chỉ ghi khi `check_out_time` NULL hoặc `verifyTime` muộn hơn lần đã lưu (giữ lần ra MUỘN nhất); trùng → return, KHÔNG update, KHÔNG event.
- **Thiếu cặp**: `leave` mà chưa từng `check-in` (`rec.check_in_time == null`) → skip + warn ([:189-194](../../../../src/modules/face-access/services/face-attendance.service.ts)).
- **Thời lượng**: KHÔNG tính `duration_seconds` — attendance lưu 2 cột thời điểm (`check_in_time`/`check_out_time`), tính hiệu khi cần. Gate có sẵn cột `duration_seconds` nên phải tính & ghi.
- **Tái dùng được**: pattern **idempotent** (chỉ ghi khi thực đổi), **gate-by-time skip**, **structured logging + try/catch không ném**. **KHÔNG tái dùng được**: mô hình 1-record-2-cột (gate là 2 dòng log + self-FK `paired_log_id`), cửa sổ theo meeting (gate không meeting), ghép chỉ theo user (gate có lượt xe `user_id` NULL).

### 0.C. `gate_access_logs` — cấu trúc phục vụ ghép cặp
- Entity ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts)): `zoneId`(NOT NULL) · `userId`(nullable) · `plateNumber` varchar(16) nullable · `direction` varchar(10) NOT NULL · `accessTime` timestamptz ([:53-57](../../../../src/modules/zones/entities/gate-access-log.entity.ts)) · `pairedLogId` uuid nullable ([:59-60](../../../../src/modules/zones/entities/gate-access-log.entity.ts)) · `durationSeconds` int nullable ([:62-63](../../../../src/modules/zones/entities/gate-access-log.entity.ts)) · self-FK `pairedLog` `@ManyToOne(...onDelete:'SET NULL')` ([:98-103](../../../../src/modules/zones/entities/gate-access-log.entity.ts)). **KHÔNG** `@DeleteDateColumn` (append-only).
- Index ([20260721000004:47-66](../../../../src/database/migrations/20260721000004-CreateGateAccessLogsTable.ts)): `IDX_gate_logs_user_time (user_id, access_time DESC)` · `IDX_gate_logs_zone_time (zone_id, access_time DESC)` · `IDX_gate_logs_plate (plate_number)` · `IDX_gate_logs_unpaired (user_id, direction) WHERE paired_log_id IS NULL`.
- ⚠ `IDX_gate_logs_unpaired` là **`(user_id, direction) WHERE paired_log_id IS NULL`** ⇒ **lượt xe không định danh** (`user_id` NULL, chỉ `plate_number`) **KHÔNG có index** hỗ trợ tìm bản chưa ghép. Ghép cặp theo biển sẽ **sequential scan** (ảnh hưởng hiệu năng khi log lớn) — xem OQ-7.
- ⚠ Xác nhận **CHƯA có unique index nào trên `paired_log_id`** (grep migrations = 0) ⇒ hiện **không gì chặn** hai `leave` cùng nhận một `enter` (QĐ-3 xử).

### 0.D. Mẫu migration schema (mirror cho index UC-106)
- [20260721000001-CreateZonesTable.ts:32-35](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts): **partial unique index** `CREATE UNIQUE INDEX "UQ_zones_code_active" ON "zones" ("zone_code") WHERE "deleted_at" IS NULL`; `down()` `DROP INDEX`. Viết TAY (không `migration:generate`). ⇒ UC-106 mirror: `CREATE UNIQUE INDEX "UQ_gate_logs_paired" ON "gate_access_logs" ("paired_log_id") WHERE "paired_log_id" IS NOT NULL`.
- ⚠ **Tiền lệ `UQ_zones_code_active`** chính là bài học của QĐ-3: pre-check tầng code có cửa sổ race, chỉ partial unique index đóng được.

### 0.E. Mốc
- `GateAccessLogService` (UC-107) hiện có `listForUser` + `listAll` ([gate-access-log.service.ts:25,32,60](../../../../src/modules/zones/services/gate-access-log.service.ts)) — read-only. UC-106 thêm logic ghi (service mới hay method mới — OQ-9).
- Migration cuối `20260722000007-SeedGateLogReadPermission.ts` ⇒ UC-106 lấy **`20260722000008`** (T0 đếm lại).
- Baseline `zones` **13 suite / 166 test** (đối chiếu không hồi quy).
- `zones.module.ts`: `imports:[forFeature(Zone, GateAccessLog, ZonePresenceEvent), AuthModule, IotModule]`, `controllers:[ZonesController, GateAccessLogController]`, `providers:[ZonesService, ZonesAuditRepository, GateAccessLogService]`.

---

## 1. Scope (UC-106)

### TRONG scope
1. **Logic ghép cặp**: quét bản ghi `leave` chưa ghép, tìm `enter` tương ứng, set `paired_log_id` + `duration_seconds` cho cả hai (chi tiết chờ OQ).
2. **Cron reconcile** trong `SchedulerService`: gọi method ghép cặp định kỳ, env-gated, try/catch không ném (khuôn §0.A).
3. **Public service method** để UC-105 (writer) gọi ghép-ngay khi có bản `leave` mới (QĐ-2). UC-106 chỉ **định nghĩa & test** method; UC-105 sau này gọi.
4. **Migration schema**: 1 partial unique index `UQ_gate_logs_paired` (QĐ-3a/QĐ-4 — ngoại lệ có chủ đích).
5. **Chống ghép trùng 2 lớp**: `SELECT ... FOR UPDATE` khoá bản `enter` + safety-net unique index (QĐ-3).
6. Unit test (100% mock — bảng rỗng, không verify được bằng dữ liệu thật).

### NGOÀI scope
- **KHÔNG** ghi/ingest bản ghi `gate_access_logs` gốc (đó là UC-105 writer — chưa xây). UC-106 chỉ **cập nhật** `paired_log_id`/`duration_seconds` của bản đã có.
- **KHÔNG** sửa `GateAccessLogService.listForUser`/`listAll` (UC-107 read-only, QĐ-7).
- **KHÔNG** đụng `zone_presence_events` (FT-21), `ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity, module `anpr`.
- **KHÔNG** thêm cột/bảng/CHECK — migration **chỉ** 1 index (QĐ-4).
- **KHÔNG** `deletedAt`/soft-delete (bảng append-only, QĐ-6) — kể cả khi join `zones`/`users`.
- **KHÔNG** HTTP CRUD endpoint cho việc ghép (cron tự chạy) — trừ khi OQ-10 chốt expose API ghép-lại-thủ-công.

## 2. Thuật toán ghép cặp (ĐÃ CHỐT OQ-1→OQ-7)

**Cửa sổ**: `window = GATE_PAIRING_WINDOW_HOURS` (env, default 24h). Cận quét: `scanFrom = now - window - buffer` (buffer đề xuất 1h — chốt ở plan). Bản cũ hơn `scanFrom` **vĩnh viễn không thể ghép** (ngoài cửa sổ) ⇒ cron không đụng tới nữa (OQ-3: cơ chế này thay cờ — không đẻ cột/cờ nào).

**Đầu vào**: bản `direction = 'leave'`, `paired_log_id IS NULL`, **`user_id IS NOT NULL`** (OQ-7: chỉ ghép đối tượng định danh — xe đã đăng ký có `user_id`; bản `user_id` NULL không ghép ở v1), `accessTime >= scanFrom`; **sắp `accessTime` tăng dần** (OQ-1: cũ nhất trước — không thì kết quả phụ thuộc thứ tự DB trả về); `LIMIT 300` (OQ-6).

**Với mỗi bản `leave` L** (mỗi bản một transaction riêng):
1. **Tìm bản `enter` E ứng viên**: `direction='enter'`, `paired_log_id IS NULL`, **`user_id = L.user_id`** (OQ-1: ghép theo người, **KHÔNG** bắt cùng `zone_id` — khuôn viên nhiều cổng, vào cổng chính ra cổng phụ là hợp lệ), `E.accessTime < L.accessTime`, `E.accessTime >= L.accessTime - window`; `ORDER BY accessTime DESC LIMIT 1` (**LIFO** — OQ-1, xem §9 kỷ luật để không đổi FIFO); khoá bằng **`FOR UPDATE`** (QĐ-3b). **KHÔNG** `deletedAt` (QĐ-6).
2. **Không tìm thấy E** → L mồ côi (quên quét vào) → để `paired_log_id` NULL, **không cờ, không cột** (OQ-3), commit rỗng/rollback + log, sang bản kế.
3. **Tìm thấy E** → `duration = Math.floor((L.accessTime - E.accessTime) / 1000)` giây (OQ-4).
4. **Ghi HAI CHIỀU trong CÙNG transaction** (OQ-5): `L.pairedLogId = E.id`, `E.pairedLogId = L.id`; `duration_seconds = duration` ở **CẢ HAI** bản (OQ-4 — UC-107 liệt kê từng dòng, nhìn dòng `enter` cũng cần thấy thời lượng). Idempotent: bản đã có `paired_log_id` → skip (khuôn §0.B).
5. **Commit**. Vi phạm `UQ_gate_logs_paired` (`23505` — race thua) → **rollback + bỏ qua bản này**, log info (KHÔNG phải lỗi — index chặn đúng), KHÔNG ném. Mirror safety-net `UQ_zones_code_active` (UC-90).

**Bản `enter` mồ côi** (còn trong khuôn viên **hoặc** quên quét ra): không nằm trong vòng lặp (chỉ quét từ `leave`). Sau cửa sổ vẫn NULL. **KHÔNG phân biệt được** "còn trong khuôn viên" vs "quên quét ra" ở v1 (residual §10).

**Trường hợp biên** (plan phải phủ test):
- Nhiều `enter` liên tiếp không có `leave` xen giữa → LIFO chọn `enter` gần `leave` nhất; các `enter` cũ hơn mồ côi (đúng — người đó đã ra giữa chừng, xem §9 lập luận LIFO).
- `leave` trước `enter` về thời gian (lỗi thiết bị) → không ghép (`E.accessTime < L.accessTime`).
- `user_id` NULL (xe chưa đăng ký) → **bỏ qua, không vào lô** (OQ-7).

## 3. Service — `GateLogPairingService` (net-new, OQ-9)

**Tách service riêng** (OQ-9) — `GateAccessLogService` (UC-107) read-only; UC-106 ghi + transaction + cron, trộn làm phình và lẫn read/write. Inject `DataSource` (cần `createQueryRunner` + `FOR UPDATE`).

- `pairBatch(): Promise<{ scanned; paired; skipped }>` — cron gọi; quét lô theo §2, trả summary (khuôn summary `no-show-check` §0.A).
- `pairForLeaveLog(leaveLogId, manager?): Promise<...>` — public, UC-105 gọi ghép-ngay 1 bản khi ingest (QĐ-2); nhận `EntityManager` để atomic với transaction của caller (khuôn ARCH-01 cross-module `manager ?? this.dataSource.manager`).
- **Idempotent**: bản đã có `paired_log_id` → skip. **Transaction + `FOR UPDATE`** + bắt `23505` rollback-bỏ-qua. **KHÔNG** `deletedAt`. **KHÔNG** đụng `GateAccessLogService` (QĐ-7).

## 4. Cron job

Thêm vào `SchedulerService` (khuôn §0.A):
```
@Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-log-pairing' })   // OQ-6
async gateLogPairing(): Promise<void> {
  if (!this.schedulerEnabled || !this.gatePairingEnabled) return;   // SCHEDULER_GATE_PAIRING_ENABLED (default OFF)
  try {
    const r = await this.gateLogPairingService.pairBatch();
    this.logger.log(`[Scheduler] gate-log-pairing: scanned=${r.scanned} paired=${r.paired} skipped=${r.skipped}`);
  } catch (e) { this.logger.error(...); }   // KHÔNG ném ra cron
}
```
- **Wiring**: `SchedulerModule` import `ZonesModule` (net-new cạnh `scheduler → zones`); `SchedulerService` constructor inject `GateLogPairingService`. Env `SCHEDULER_GATE_PAIRING_ENABLED` default **OFF** (khuôn các job nhạy cảm). **KHÔNG** ghi `background_jobs` (OQ-6 — không job nào ghi).
- ⚠ **THUẦN THÊM MỚI** vào `scheduler.service.ts` (§1.1 prompt): đúng 1 inject + 1 cờ env + 1 job; **KHÔNG đụng** 9 job cũ, không đổi thứ tự, không refactor.
- ⚠ Cạnh `scheduler → zones` mới: `ZonesModule` KHÔNG được import `SchedulerModule` (một chiều). `zones → iot` đã có; không circular vì `scheduler` là orchestrator tầng trên.

## 5. Migration schema (ngoại lệ có chủ đích — QĐ-4)

File `20260722000008-AddGateLogsPairedUniqueIndex.ts` (T0 đếm lại). Mirror [20260721000001:32-35,51](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts):
```
up:   CREATE UNIQUE INDEX "UQ_gate_logs_paired"
        ON "gate_access_logs" ("paired_log_id") WHERE "paired_log_id" IS NOT NULL;
down: DROP INDEX "UQ_gate_logs_paired";
```
- Partial (WHERE NOT NULL) ⇒ nhiều bản chưa ghép (`paired_log_id` NULL) không bị unique chặn; chỉ chặn **hai bản khác nhau cùng trỏ tới một `paired_log_id`** — tức hai `leave` cùng nhận một `enter` (nếu QĐ-5 hai chiều thì cũng chặn hai `enter` nhận một `leave`).
- ⚠ **KHÔNG** thêm cột/bảng/CHECK/index khác. OQ-7 đã chốt **KHÔNG** ghép xe chưa đăng ký ⇒ **KHÔNG** cần index `plate_number` — không mở rộng ngoại lệ.
- ⚠ **Rủi ro áp lên RDS chung**: index này áp lên bảng thật (dù local rỗng). Nếu RDS đã có dữ liệu ghép trùng (không nên, vì chưa ai ghép) thì `CREATE UNIQUE INDEX` fail — plan phải lường (residual).

## 6. Requirements (EARS)

- **R1**: **WHEN** cron `gate-log-pairing` chạy (nếu env bật) **→** hệ thống quét lô bản `leave` chưa ghép và ghép mỗi bản với `enter` tương ứng theo tiêu chí **[OQ-1]** trong cửa sổ **[OQ-2]**.
- **R2 (crux race)**: **WHILE** ghép một bản, hệ thống PHẢI khoá bản `enter` ứng viên bằng `SELECT ... FOR UPDATE` **VÀ** dựa vào `UQ_gate_logs_paired` làm safety-net — vi phạm `23505` thì bỏ qua bản đó, KHÔNG ném (QĐ-3).
- **R3 (idempotent)**: **IF** bản `leave` đã có `paired_log_id` **→** skip, KHÔNG ghi lại.
- **R4**: **WHEN** không tìm được `enter` ứng viên **→** để `paired_log_id` NULL (KHÔNG cột đánh dấu mới — QĐ-4), log/skip **[OQ-3]**.
- **R5**: **WHERE** ghép thành công **→** ghi `duration_seconds` **[OQ-4]** và `paired_log_id` **[OQ-5]**; UC-106 là **nơi DUY NHẤT** ghi 2 field này (QĐ-7).
- **R6 (append-only)**: **WHILE** mọi truy vấn, **KHÔNG** dùng `deleted_at`/soft-delete trên `gate_access_logs` (không có cột) và **KHÔNG** lọc `deletedAt` của `zones`/`users` nếu join (QĐ-6).
- **R7 (direction)**: **WHERE** so `direction`, dùng hằng `GATE_DIRECTIONS` (`'enter'`/`'leave'`) — CẤM `'in'`/`'out'` (QĐ-5).
- **R8 (cron an toàn)**: **IF** logic ghép ném lỗi **→** cron bắt, log, KHÔNG để lan ra làm chết scheduler.
- **R9**: **WHEN** UC-105 (writer) ingest một bản `leave` mới **→** có thể gọi `pairForLeaveLog(id, manager)` để ghép ngay (UC-106 định nghĩa & test; UC-105 gọi sau).

## 7. Constitution

| Rule | Áp dụng UC-106 |
| :--- | :--- |
| **SEC-03** | Mọi giá trị (id, thời gian) qua bound param; CẤM nối chuỗi SQL. |
| **DATA-01** | Bảng append-only — KHÔNG `deletedAt` (đảo chiều so với UC vận hành). |
| **DATA-02 (ngoại lệ)** | UC-106 ĐƯỢC tạo migration schema — CHỈ 1 partial unique index (toàn vẹn dữ liệu), KHÔNG cột/bảng/CHECK. |
| **ARCH-01** | `pairForLeaveLog` nhận `EntityManager` để atomic với transaction của UC-105 (cross-module). |
| **ARCH-02** | Cron try/catch không ném; lô có giới hạn để không quét toàn bảng. |
| **ARCH-03 (idempotent)** | Chạy lại cùng dữ liệu → không đổi (bản đã ghép skip). |
| **ENG-01** | Test ≥80% (100% mock — bảng rỗng). |
| **ENG-03** | Lỗi log gọn, không lộ SQL/stack ra ngoài. |
| **ENG-04** | Không thêm dependency (`@nestjs/schedule` đã có). |

## 8. QUYẾT ĐỊNH ĐÃ CHỐT (nền — KHÔNG mở lại)

1. **Module** = `zones` (cùng chỗ `GateAccessLogEntity`/`GateAccessLogService`).
2. **Kích hoạt** = cron reconcile + public method cho UC-105 gọi. **KHÔNG** event hook (UC-105 chưa tồn tại).
3. **Chống ghép trùng 2 lớp**: partial unique index `UQ_gate_logs_paired` + `SELECT ... FOR UPDATE`.
4. **Ngoại lệ migration schema**: được tạo **1** partial unique index (toàn vẹn dữ liệu); ngoài ra KHÔNG cột/bảng/CHECK.
5. **`direction`** = `'enter'`/`'leave'` qua `GATE_DIRECTIONS`; CẤM `'in'`/`'out'`.
6. **Append-only**: KHÔNG `deletedAt`/`IsNull()` bất kỳ đâu, kể cả bảng join.
7. **Ranh giới UC-107**: UC-106 là nơi DUY NHẤT ghi `paired_log_id`/`duration_seconds`; KHÔNG sửa `listForUser`/`listAll`.

## 9. OPEN QUESTIONS — ĐÃ CHỐT

- **OQ-1 (CRUX) — Tiêu chí ghép cặp.** Ghép `leave` với `enter` nào? *Đề xuất*: khoá theo `user_id` cho người định danh; **cùng `zone_id` KHÔNG bắt buộc** (khuôn viên nhiều cổng — vào cổng chính, ra cổng phụ là hợp lệ) ⇒ ghép theo đối tượng, không theo cổng; chọn **LIFO** (`enter` gần nhất trước `leave`) — người ra vào nhiều lần thì lượt ra khớp lượt vào gần nhất. *Rủi ro FIFO*: ghép lượt ra với lượt vào rất cũ (bỏ quên). **Chờ chốt** (user-only / +plate cho xe [OQ-7]; cùng-zone hay khác-zone; LIFO/FIFO).
  → **CHỐT: `user_id` · KHÔNG bắt cùng `zone_id` · LIFO** (`enter` gần nhất trước `leave`). Xử lô `leave` theo `accessTime` **tăng dần**. Lập luận LIFO (kịch bản `enter@8:00`·`enter@13:00`·`leave@17:00` → sự tồn tại `enter@13:00` chứng minh đã ra buổi trưa; FIFO cho 9h "có mặt liên tục" là **sai chứng minh được**) — ghi §Kỷ luật plan để không đổi FIFO.
- **OQ-2 (CRUX) — Cửa sổ thời gian tối đa** `enter`↔`leave`. *Đề xuất*: **24h** (bao trọn một ngày làm việc + ở lại muộn). *Rủi ro quá ngắn* (vd 12h): bỏ sót người ở lại qua ca đêm/qua đêm. *Rủi ro quá dài* (vd 72h): ghép nhầm lượt vào hôm trước với lượt ra hôm sau khi quên quét. **Chờ chốt** con số + xử qua đêm.
  → **CHỐT: 24h qua env `GATE_PAIRING_WINDOW_HOURS` (default 24)** — không hard-code; đọc qua `ConfigService.get<number>`.
- **OQ-3 (CRUX) — Thiếu cặp.** (a) `enter` không `leave`: còn trong khuôn viên **hay** quên quét ra — *đề xuất KHÔNG phân biệt được* ở v1 (không có tín hiệu khác), để NULL, residual. (b) `leave` không `enter`: quên quét vào → để NULL, log. (c) Đánh dấu "không ghép được": **KHÔNG cột mới** (QĐ-4) → chỉ để `paired_log_id` NULL; phân biệt "chưa xử" vs "đã xử không ghép được" bằng gì? *Đề xuất*: chấp nhận không phân biệt, hoặc dùng `metadata_json` đánh cờ — **chờ chốt**.
  → **CHỐT — KHÁC đề xuất: KHÔNG cờ, chặn bằng CỬA SỔ QUÉT.** Cron chỉ xét bản `accessTime >= now - (window + buffer)`; bản cũ hơn vĩnh viễn ngoài cửa sổ ⇒ không quét lại. `paired_log_id` NULL thuần là đủ, **KHÔNG** đẻ cờ `metadata_json`. Lợi thêm: mỗi lần đọc ~1 ngày thay vì toàn bảng. `buffer` đề xuất 1h (chốt plan). (a) `enter` không `leave` → NULL, không phân biệt "còn trong khuôn viên" vs "quên quét ra" (residual); (b) `leave` không `enter` → NULL + log warn; (c) không cột/cờ.
- **OQ-4 — `duration_seconds` tính & lưu.** *Đề xuất*: `floor((leave.accessTime - enter.accessTime)/1000)` giây, lưu ở **bản `leave`**. **Chờ chốt** (làm tròn; lưu leave-only / cả hai).
  → **CHỐT — KHÁC đề xuất: ghi CẢ HAI bản** (`enter` và `leave`), cùng giá trị, cùng transaction. Lý do: UC-107 liệt kê từng dòng log; nhìn dòng `enter` cũng cần thấy thời lượng. Công thức `Math.floor((leave.accessTime - enter.accessTime)/1000)` giây.
- **OQ-5 — `paired_log_id` một chiều hay hai chiều.** *Đề xuất*: **hai chiều** (`leave→enter` và `enter→leave`) để UC-107 từ bản nào cũng tra được cặp. *Hệ quả unique index*: hai chiều ⇒ `UQ_gate_logs_paired` chặn cả hai `leave` nhận một `enter` LẪN hai `enter` nhận một `leave` (mạnh hơn). *Rủi ro*: phải update 2 dòng/cặp trong transaction. **Chờ chốt** (một chiều leave→enter / hai chiều).
  → **CHỐT: HAI CHIỀU** trong cùng transaction; `UQ_gate_logs_paired` chặn cả hai hướng va chạm.
- **OQ-6 — Chu kỳ cron + lô + env + `background_jobs`.** *Đề xuất*: `EVERY_5_MINUTES` (khuôn no-show/auto-release), lô 200–500 bản/lần, env `SCHEDULER_GATE_PAIRING_ENABLED` default **OFF**, **KHÔNG** ghi `background_jobs` (không job nào ghi — §0.A). **Chờ chốt**.
  → **CHỐT: `EVERY_5_MINUTES`, lô 300, env `SCHEDULER_GATE_PAIRING_ENABLED` default OFF, KHÔNG `background_jobs`.**
- **OQ-7 (CRUX) — Lượt xe không định danh** (`user_id` NULL). Ghép theo `plate_number`? *Bối cảnh*: `IDX_gate_logs_unpaired` chỉ index `user_id` ⇒ ghép theo biển = **seq scan** (§0.C). *Ba lựa chọn*: (a) seq scan; (b) +index (mở rộng ngoại lệ); (c) KHÔNG ghép xe chưa đăng ký ở v1. *Đề xuất*: (c).
  → **CHỐT: (c) — diễn đạt lại cho đúng phạm vi.** Ghép theo `user_id`; **xe ĐÃ ĐĂNG KÝ có `user_id` (writer UC-105 gán khi resolve được) ⇒ vẫn ghép bình thường** — đúng nghiệp vụ chính. **Chỉ bản `user_id` NULL** (xe chưa đăng ký/xe lạ) không ghép ở v1 (thời gian lưu lại của xe lạ ít giá trị, đã bị cờ ở luồng khác). **KHÔNG** thêm index `plate_number`. Ghép xe chưa đăng ký là UC sau (kèm index).
- **OQ-8 — Ghép lại / sửa sai.** → **CHỐT: ngoài scope v1** — không API gỡ; nhầm thì sửa DB thủ công (residual).
- **OQ-9 — Service mới hay thêm `GateAccessLogService`.** → **CHỐT: tách `GateLogPairingService` mới** — UC-107 read-only, UC-106 ghi+transaction+cron; trộn làm phình và lẫn read/write.
- **OQ-10 — Expose API ghép-lại-thủ-công?** → **CHỐT: KHÔNG ở v1** — không route, không permission mới (residual).
- **OQ-11 — Mâu thuẫn prompt vs luật**: → **XÁC NHẬN không có mâu thuẫn mới**. Ngoại lệ migration schema (QĐ-4) là chủ đích, có kiểm soát. Các lệch đã biết (4 role thật, error envelope, Swagger, `spec/global/` rỗng) giữ nguyên.

## 10. Residuals / known-gaps

- **⚠ KHÔNG verify được bằng dữ liệu thật**: `gate_access_logs` **rỗng** (writer UC-105 chưa xây) ⇒ toàn bộ test là **mock**; không có e2e/dữ liệu thật cho tới khi UC-105 ingest. Đúng/sai thuật toán chỉ được kiểm chứng thật khi UC-105 hoạt động.
- **Ràng buộc lên UC-105 (writer)**: (a) ghi `direction` đúng `'enter'`/`'leave'`; (b) gán `user_id` khi biển resolve được (để ghép theo người — nối tiếp ràng buộc UC-107); (c) có thể gọi `pairForLeaveLog(id, manager)` để ghép ngay khi ingest `leave`.
- **Lượt xe `user_id` NULL** (OQ-7 chốt c): xe chưa đăng ký (user_id NULL) không ghép ở v1 → lịch sử chúng không có `duration_seconds`. Xe **đã đăng ký** (có user_id) vẫn ghép bình thường. Ghép xe chưa đăng ký theo biển là UC sau (kèm index `plate_number`).
- **`enter` mồ côi không phân biệt "còn trong khuôn viên" vs "quên quét ra"** (OQ-3): dashboard hiện diện realtime (nếu có) sẽ đếm nhầm nếu dựa `enter` chưa ghép.
- **Không chống overlap cron tường minh** (§0.A): hai lần chạy chồng lấn dựa vào `FOR UPDATE` + unique index để không ghép trùng; nếu lô lớn chạy quá chu kỳ, cần thêm lock (task riêng).
- **Migration index áp lên RDS chung**: nếu RDS đã có cặp trùng (bất thường) thì `CREATE UNIQUE INDEX` fail — plan phải kiểm tra trước khi áp.
- **Cạnh `scheduler → zones` mới**: `SchedulerModule` phình thêm 1 import; giữ một chiều.
- **Nợ hệ thống**: global exception filter, Swagger, 5 file `spec/global/` rỗng — giữ nguyên.

---

> **STOP.** Spec-only. OQ-1→OQ-11 **ĐÃ CHỐT** (§9). 7 QĐ nền §8 KHÔNG mở lại. Đã sang bước **plan** ([plan.md](./plan.md)). Chưa viết code/`tasks.md`, chưa chạy migration/seed/test/build, chưa commit.
