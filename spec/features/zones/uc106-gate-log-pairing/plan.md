# GAP-001 — plan.md (UC-106 Zones: ghép cặp vào–ra)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan GAP-001 sau spec DUYỆT + chốt OQ-1→OQ-11. `GateLogPairingService` net-new (transaction + `FOR UPDATE`); cron `gate-log-pairing` EVERY_5_MINUTES (env OFF) thêm vào `SchedulerService`; migration `20260722000008` partial unique index `UQ_gate_logs_paired`. Thuật toán: quét `leave` chưa ghép trong cửa sổ (user_id NOT NULL), sắp accessTime tăng dần, LIFO chọn `enter`, ghi hai chiều + duration cả hai bản, bắt `23505` rollback-bỏ-qua. ⚠ Sửa 2 file ngoài `zones` (scheduler) — thuần thêm mới. **0 chỗ `deletedAt`**. | Toàn bộ |
| 2026-07-23 | Cập nhật khoá bản ghi thành **`FOR UPDATE SKIP LOCKED`** (cả 2 bước khoá §2). Lý do: `SchedulerService` không chống chồng lấn + UC-105 gọi song song ⇒ `FOR UPDATE` trần làm lượt sau xếp hàng chờ, dồn ứ. `SKIP LOCKED` bỏ qua bản đang bị khoá, tự lành lượt kế. Thêm ràng buộc T0 verify `setOnLocked('skip_locked')` (không có → DỪNG, cấm quay về `FOR UPDATE` trần). §9 thêm kỷ luật (j). | §2, §9 |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 7 QĐ §8 + 11 OQ đã chốt.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **Mẫu cron job** ([scheduler.service.ts:124-132 `device-offline-detect`](../../../../src/modules/scheduler/scheduler.service.ts)): `@Cron(CronExpression.EVERY_MINUTE, { name })` + gate `if (!this.schedulerEnabled || !this.xEnabled) return;` + `try { await service.method(); this.logger.log(summary); } catch (e) { this.logger.error(...); }`. Cờ đọc ở constructor: `this.xEnabled = this.configService.get<boolean>('SCHEDULER_X_ENABLED', false)` ([:51-78](../../../../src/modules/scheduler/scheduler.service.ts)).
- **`ConfigService.get<number>`** ([face-attendance.service.ts:170](../../../../src/modules/face-access/services/face-attendance.service.ts)): `this.configService.get<number>('FACE_SYNC_GRACE_MINUTES', 5)` — mẫu đọc số env cho `GATE_PAIRING_WINDOW_HOURS`/`GATE_PAIRING_BUFFER_HOURS`.
- **Transaction `queryRunner`** ([zones.service.ts:131-154](../../../../src/modules/zones/services/zones.service.ts)): `const qr = this.dataSource.createQueryRunner(); await qr.connect(); await qr.startTransaction(); try { ...; await qr.commitTransaction(); } catch (e) { await qr.rollbackTransaction(); throw e; } finally { await qr.release(); }`. Mirror cho mỗi bản `leave`.
- **`FOR UPDATE` có tiền lệ**: raw SQL [users-change-password.repository.ts:41](../../../../src/modules/auth/repositories/users-change-password.repository.ts) (`... FOR UPDATE`); QueryBuilder [meetings.service.ts:1172](../../../../src/modules/meetings/services/meetings.service.ts) (`lock: { mode: 'pessimistic_write' }`). UC-106 dùng QueryBuilder `.setLock('pessimistic_write')` HOẶC raw SQL trong `qr.manager.query(...)` — chốt ở code (đề xuất raw SQL để kiểm soát chính xác câu lệnh).
- **Mẫu migration partial unique index** ([20260721000001-CreateZonesTable.ts:32-35,51](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts)): `CREATE UNIQUE INDEX "UQ_..." ON "table" ("col") WHERE ...`; `down()` `DROP INDEX`. Viết TAY.
- **`23505` safety-net** ([vehicle-registration.service.ts:212-218](../../../../src/modules/anpr/services/vehicle-registration.service.ts) `isUniqueViolation`): `(e as {driverError?:{code?:string}})?.driverError?.code === '23505'`. Tái dùng pattern nhận diện.
- **`GateAccessLogEntity`** field: `pairedLogId`, `durationSeconds`, `accessTime`, `direction`, `userId`, `zoneId`, `plateNumber` (RECON spec §0.C). **KHÔNG `@DeleteDateColumn`**.
- **Mốc**: migration cuối `20260722000007-SeedGateLogReadPermission.ts` ⇒ UC-106 lấy **`20260722000008`** (T0 đếm lại). Baseline `zones` **13 suite / 166 test**.
- **`SchedulerService` constructor** ([scheduler.service.ts:37-46](../../../../src/modules/scheduler/scheduler.service.ts)) inject 7 service + `ConfigService`; **`SchedulerModule`** ([scheduler.module.ts:24-32](../../../../src/modules/scheduler/scheduler.module.ts)) import 5 domain module + `ScheduleModule.forRoot()` + `ConfigModule`. UC-106 thêm `ZonesModule` + inject `GateLogPairingService`.
- **`GATE_DIRECTIONS`** đã có ([gate-direction.constant.ts](../../../../src/modules/zones/constants/gate-direction.constant.ts)) — dùng `'enter'`/`'leave'`.

## 1. Quyết định đã chốt (OQ + §8 + Constitution)

**OQ**: user_id + LIFO + không cùng-zone + xử `leave` accessTime tăng dần (OQ-1) · cửa sổ 24h env `GATE_PAIRING_WINDOW_HOURS` (OQ-2) · cửa sổ quét chặn quét-lại, không cờ (OQ-3) · duration cả hai bản floor (OQ-4) · paired_log_id hai chiều (OQ-5) · cron EVERY_5_MINUTES lô 300 env OFF không background_jobs (OQ-6) · chỉ ghép `user_id NOT NULL` (OQ-7) · không API gỡ (OQ-8) · tách `GateLogPairingService` (OQ-9) · không route/permission (OQ-10).

**§8 nền**: module zones · cron+public method · unique index + FOR UPDATE · ngoại lệ migration schema (1 index) · direction enter/leave · append-only KHÔNG deletedAt · nơi duy nhất ghi paired_log_id/duration.

- **SEC-03**: id/thời gian qua bound param; CẤM nối chuỗi.
- **DATA-01 (đảo chiều)**: KHÔNG `deletedAt`/`IsNull()` bất kỳ đâu (bảng append-only). Không join `zones`/`users` ở UC-106 (chỉ đọc/ghi `gate_access_logs`) nên không phát sinh nguy cơ.
- **DATA-02 (ngoại lệ)**: ĐƯỢC tạo 1 partial unique index; KHÔNG cột/bảng/CHECK/index khác.
- **ARCH-01**: `pairForLeaveLog(id, manager?)` nhận `EntityManager` (atomic với UC-105).
- **ARCH-02**: cron try/catch không ném; lô 300 giới hạn.
- **ARCH-03**: idempotent (bản đã ghép skip; chạy lại không đổi).

## 2. Thuật toán ghép cặp — từng bước

**Tham số** (đọc constructor): `windowH = get<number>('GATE_PAIRING_WINDOW_HOURS', 24)`, `bufferH = get<number>('GATE_PAIRING_BUFFER_HOURS', 1)`, `BATCH = 300`.

**`pairBatch()`**:
```
scanFrom = new Date(Date.now() - (windowH + bufferH) * 3600_000)
// Lô leave chưa ghép, chỉ đối tượng định danh, trong cửa sổ, CŨ NHẤT TRƯỚC.
leaves = repo.find/QB: direction='leave' AND pairedLogId IS NULL AND userId IS NOT NULL
                       AND accessTime >= scanFrom
                       ORDER BY accessTime ASC LIMIT BATCH        // OQ-1 thứ tự
let scanned=0, paired=0, skipped=0
for (const L of leaves) {
  scanned++
  const outcome = await this.pairOne(L.id)      // mỗi bản 1 transaction
  if (outcome === 'paired') paired++; else skipped++
}
return { scanned, paired, skipped }
```

**`pairOne(leaveId)` / `pairForLeaveLog(leaveId, manager?)`** — bọc transaction (dùng `manager` của caller nếu có, ngược lại `createQueryRunner`):
1. Load `L` (khoá): `SELECT ... WHERE id=$1 AND direction='leave' FOR UPDATE SKIP LOCKED`. **Không lấy được** (đang bị tiến trình khác giữ khoá) → coi như **`skipped`** (bản đang được xử lý nơi khác), đi tiếp. Nếu `L.pairedLogId != null` → **idempotent skip** (return 'skipped').
2. Tìm `E` ứng viên (LIFO) + khoá:
   ```
   SELECT id, access_time FROM gate_access_logs
   WHERE direction='enter' AND paired_log_id IS NULL
     AND user_id = $L.userId
     AND access_time < $L.accessTime
     AND access_time >= $L.accessTime - windowH*interval
   ORDER BY access_time DESC LIMIT 1
   FOR UPDATE SKIP LOCKED
   ```
   (KHÔNG bắt cùng `zone_id` — OQ-1. KHÔNG `deletedAt`. **`SKIP LOCKED`**: ứng viên gần nhất đang bị khoá → PostgreSQL bỏ qua nó và trả bản kế theo cùng LIFO, KHÔNG chờ.)
   ⚠ **Cú pháp**: `SKIP LOCKED` + `ORDER BY ... LIMIT` — TypeORM qua `.setLock('pessimistic_write').setOnLocked('skip_locked')` HOẶC raw query; T0 verify version có `setOnLocked` không, không có → DỪNG (KHÔNG quay về `FOR UPDATE` trần).
3. Không có `E` → return 'skipped' (leave mồ côi, để NULL, log debug — OQ-3, KHÔNG cờ).
4. Có `E` → `duration = Math.floor((L.accessTime.getTime() - E.accessTime.getTime())/1000)`.
5. **UPDATE hai bản** (cùng transaction — OQ-4/OQ-5):
   ```
   UPDATE gate_access_logs SET paired_log_id=$E.id, duration_seconds=$duration WHERE id=$L.id
   UPDATE gate_access_logs SET paired_log_id=$L.id, duration_seconds=$duration WHERE id=$E.id
   ```
6. Commit → return 'paired'.
7. **Bắt lỗi**: nếu `isUniqueViolation(e)` (`23505` trên `UQ_gate_logs_paired`) → rollback, log info "race — bản đã được tiến trình khác ghép", return 'skipped' (KHÔNG ném). Lỗi khác → rollback + throw (cron bọc try/catch nuốt).
8. **`finally`**: nếu tự tạo `queryRunner` → `await qr.release()` ở **mọi** nhánh.

**Trường hợp biên** (test §7): nhiều `enter` liên tiếp → LIFO chọn gần nhất, cũ hơn mồ côi; `leave` trước `enter` → `access_time < L` loại; `user_id` NULL → không vào lô; đã ghép → skip.

## 3. Service `GateLogPairingService` (net-new, OQ-9)

File `src/modules/zones/services/gate-log-pairing.service.ts`. `@Injectable`, `constructor(private readonly dataSource: DataSource, private readonly configService: ConfigService)`. Đọc `windowH`/`bufferH` ở constructor.
- `pairBatch(): Promise<{ scanned; paired; skipped }>` — cron gọi (§2).
- `pairForLeaveLog(leaveId: string, manager?: EntityManager): Promise<'paired'|'skipped'>` — public, UC-105 gọi ghép-ngay; `manager ?? this.dataSource.manager` (ARCH-01). Nếu có `manager` (caller đã trong transaction) thì KHÔNG tự commit/release; nếu không thì tự quản transaction. **Chốt chi tiết ở code** (đề xuất: tách `pairOneWithManager(manager, leaveId)` lõi, `pairBatch`/`pairForLeaveLog` bọc transaction).
- `private isUniqueViolation(e)` — mirror ANPR (`driverError.code === '23505'`).
- **KHÔNG** đụng `GateAccessLogService` (QĐ-7). **KHÔNG** `deletedAt`.

## 4. Cron job — sửa `scheduler.service.ts` + `scheduler.module.ts` (THUẦN THÊM MỚI, §1.1)

**`scheduler.service.ts` — đúng 3 thay đổi**:
1. **1 inject**: thêm `private readonly gateLogPairingService: GateLogPairingService` vào constructor (+ import).
2. **1 cờ env**: `this.gatePairingEnabled = this.configService.get<boolean>('SCHEDULER_GATE_PAIRING_ENABLED', false)` + khai field `private readonly gatePairingEnabled: boolean;` + thêm vào log init.
3. **1 job**:
   ```
   @Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-log-pairing' })
   async gateLogPairing(): Promise<void> {
     if (!this.schedulerEnabled || !this.gatePairingEnabled) return;
     try {
       const r = await this.gateLogPairingService.pairBatch();
       this.logger.log(`[Scheduler] gate-log-pairing: scanned=${r.scanned} paired=${r.paired} skipped=${r.skipped}`);
     } catch (e) {
       this.logger.error(`[Scheduler] gate-log-pairing failed: ${e instanceof Error ? e.message : 'unknown'}`);
     }
   }
   ```
- ⚠ **KHÔNG** đụng 9 job cũ, không đổi thứ tự, không refactor.

**`scheduler.module.ts` — đúng 1 thay đổi**: thêm `ZonesModule` vào `imports` (+ import class). Giữ nguyên phần còn lại. `ZonesModule` export `TypeOrmModule` + providers — cần export `GateLogPairingService` để `SchedulerService` inject được ⇒ **`zones.module.ts` cũng phải thêm `GateLogPairingService` vào `providers` VÀ `exports`** (xem §6). Cạnh `scheduler → zones` một chiều (zones KHÔNG import scheduler).

## 5. Migration schema (ngoại lệ có chủ đích — QĐ-4)

File `src/database/migrations/20260722000008-AddGateLogsPairedUniqueIndex.ts` (T0 đếm lại). Mirror [20260721000001:32-35,51](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts), viết TAY:
```
up():   await qr.query(`CREATE UNIQUE INDEX "UQ_gate_logs_paired"
          ON "gate_access_logs" ("paired_log_id") WHERE "paired_log_id" IS NOT NULL`);
down(): await qr.query(`DROP INDEX "UQ_gate_logs_paired"`);
```
- Partial (WHERE NOT NULL): nhiều bản chưa ghép (NULL) không bị chặn; chặn 2 bản khác nhau cùng trỏ 1 `paired_log_id` (2 `leave` nhận 1 `enter` — và vì hai chiều, cả 2 `enter` nhận 1 `leave`).
- ⚠ **KHÔNG** cột/bảng/CHECK/index khác (OQ-7 chốt không index `plate_number`).
- ⚠ **Rủi ro RDS**: `CREATE UNIQUE INDEX` **FAIL** nếu bảng đang có 2 bản trùng `paired_log_id`. Bảng hiện **rỗng** nên local an toàn; người áp lên RDS phải kiểm `SELECT paired_log_id, count(*) ... GROUP BY ... HAVING count(*)>1` trước (residual).

## 6. File list

### Net-new
**Code (2)**
- `src/modules/zones/services/gate-log-pairing.service.ts`
- `src/database/migrations/20260722000008-AddGateLogsPairedUniqueIndex.ts`

**Test (1)**
- `src/modules/zones/services/gate-log-pairing.service.spec.ts`

### Modified (trong `zones`)
- `src/modules/zones/zones.module.ts` — thêm `GateLogPairingService` vào `providers` **VÀ `exports`** (để `SchedulerModule` inject). Giữ nguyên phần còn lại.

### Modified (ngoài `zones`)
- `src/modules/scheduler/scheduler.service.ts` — **thuần thêm** 1 inject + 1 cờ env + 1 job (§4). KHÔNG đụng 9 job cũ.
- `src/modules/scheduler/scheduler.module.ts` — thêm `ZonesModule` vào `imports`.
- (test) `scheduler.service.spec.ts` nếu tồn tại — thêm mock `GateLogPairingService` provider (T0 kiểm tra có file spec không; nếu có, chỉ thêm mock, không đổi assert job cũ).

> Tổng ~**3 net-new + 1 modified (zones) + 2-3 modified (scheduler)**. **1 migration schema** (ngoại lệ). `GateAccessLogService`/`ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/`app.module.ts`/`data-source.ts`/module `anpr` **KHÔNG đổi**.

## 7. Test (mock repo — KHÔNG DB)

`gate-log-pairing.service.spec.ts` — mock `DataSource`: `createQueryRunner` trả `{ connect, startTransaction, commitTransaction, rollbackTransaction, release, manager: { query } }` (jest.fn); `configService.get` trả window/buffer. Kiểm `manager.query` mock.calls.
- **Ghép thành công**: `enter` + `leave` khớp user, trong cửa sổ → assert **2 UPDATE** (cả `L` lẫn `E`), `paired_log_id` hai chiều, `duration_seconds` **bằng nhau + đúng** `floor((leave-enter)/1000)`, `commitTransaction` gọi.
- **LIFO**: 3 `enter` (8:00/13:00/16:00) cùng user, `leave@17:00` → chọn `enter@16:00` (gần nhất); assert query có `ORDER BY access_time DESC LIMIT 1`.
- **Thứ tự xử lý `leave` tăng dần**: query lô có `ORDER BY access_time ASC`.
- **Không ứng viên** → không UPDATE nào, return skipped, KHÔNG throw.
- **Ngoài cửa sổ**: `enter` cũ hơn `leave - window` → không chọn (điều kiện `>= L.accessTime - window`).
- **`user_id` NULL**: lô loại bản `user_id` NULL (query có `user_id IS NOT NULL`); `pairOne` bản NULL không xảy ra.
- **`23505`**: `manager.query` UPDATE ném `{driverError:{code:'23505'}}` → `rollbackTransaction` gọi, `commitTransaction` KHÔNG, return skipped, **KHÔNG ném ra ngoài**.
- **`finally release()`**: assert `release` gọi ở nhánh thành công, nhánh không-ứng-viên, nhánh `23505`, nhánh lỗi khác.
- **Cửa sổ quét**: `scanFrom` = `now - (window+buffer)h`; assert query lô có điều kiện `access_time >= scanFrom` (dùng thời gian truyền vào, không `Date.now()` trong assert — mock giờ hoặc so khoảng).
- **Lô giới hạn 300**: query có `LIMIT 300`.
- **Idempotent**: `L.pairedLogId` đã set → skip, không UPDATE.
- **KHÔNG `deletedAt`**: assert KHÔNG câu query nào chứa chuỗi `deleted`.

**Cron (scheduler.service.spec nếu có)**: job tắt (env OFF) → `pairBatch` KHÔNG gọi; bật → gọi 1 lần; `pairBatch` ném → `logger.error`, KHÔNG lan (job không reject). **166 test cũ + 9 job cũ không hồi quy**.

**Nguyên tắc**: 100% mock — bảng rỗng, KHÔNG DB/e2e (residual: không verify được bằng dữ liệu thật cho tới UC-105).

## 8. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint **chỉ file touched** = 0 rule mới (KHÔNG `npm run lint` trần).
- `npx jest src/modules/zones src/modules/scheduler` xanh — **166 test zones + test scheduler cũ không hồi quy**, đối chiếu baseline T0.
- Coverage `GateLogPairingService` ≥80%.
- **DI-proof**: `NestFactory.create(AppModule, {preview:true})` — 0 `UnknownDependenciesException`, 0 circular (cạnh `scheduler → zones` mới — phải chạy để chắc không circular).
- **KHÔNG** `migration:run` (kể cả local), **KHÔNG** RDS, **KHÔNG** live smoke, **KHÔNG** commit.
- **Bàn giao**: cron mặc định OFF (`SCHEDULER_GATE_PAIRING_ENABLED=false`); bật mới chạy. Bảng `gate_access_logs` **rỗng** ⇒ chạy thật không ghép được gì cho tới UC-105. Migration `20260722000008` phải chạy trước khi bật cron (unique index là safety-net); áp lên RDS phải kiểm trùng trước (§5).
- **Owed**: writer UC-105 (ingest + gán user_id + direction enter/leave + gọi `pairForLeaveLog`) · ghép xe chưa đăng ký theo biển (+index `plate_number`) — UC sau · phân biệt "còn trong khuôn viên" vs "quên quét ra" · API gỡ cặp (OQ-8) · chống overlap cron tường minh nếu lô > chu kỳ · global exception filter · Swagger · 5 file `spec/global/` rỗng.

## 9. Kỷ luật

- **(a) LIFO — CẤM đổi FIFO**: chọn `enter` gần nhất trước `leave`. Kịch bản chứng minh: `enter@8:00` · `enter@13:00` · `leave@17:00` (quên quét ra buổi trưa) → LIFO ghép `leave@17:00`←`enter@13:00` (4h), `enter@8:00` mồ côi. **Sự tồn tại `enter@13:00` chứng minh người đó đã ra ngoài** khoảng 8:00–13:00 ⇒ con số 9h "có mặt liên tục" của FIFO là **sai sự thật chứng minh được**. Người sau KHÔNG được đổi sang FIFO.
- **(b) Cửa sổ quét, KHÔNG cờ**: chặn quét-lại-vô-hạn bằng `accessTime >= now - (window+buffer)`, KHÔNG đẻ cờ `metadata_json`/cột. Bản ngoài cửa sổ vĩnh viễn không ghép.
- **(c) `scheduler.service.ts` THUẦN THÊM MỚI**: đúng 1 inject + 1 cờ + 1 job; CẤM đụng 9 job cũ / đổi thứ tự / refactor.
- **(d) Cạnh `scheduler → zones` một chiều**: `zones` KHÔNG import `scheduler`; `SchedulerModule` là orchestrator tầng trên (đã import 5 domain module) ⇒ không circular.
- **(e) `duration_seconds` ghi CẢ HAI bản, CÙNG transaction** — lệch transaction thì hai bản có thể khác giá trị/nửa vời. `paired_log_id` hai chiều cũng cùng transaction.
- **(f) Bảng append-only — CẤM `deletedAt`/`IsNull()`** mọi truy vấn (không có cột). Test assert không chuỗi `deleted`.
- **(g) `FOR UPDATE SKIP LOCKED` + `UQ_gate_logs_paired` là 2 lớp**: row lock (SKIP LOCKED) giảm va chạm **không chờ**, unique index là chốt cuối; `23505` → rollback-bỏ-qua, KHÔNG ném (là race đã chặn đúng, không phải lỗi).
- **(j) Khoá dùng `SKIP LOCKED`, KHÔNG `FOR UPDATE` trần**: `SchedulerService` không chống chồng lấn, và UC-105 sẽ gọi `pairForLeaveLog` song song. `FOR UPDATE` trần làm lượt chạy sau **xếp hàng chờ** lượt trước → dồn ứ qua nhiều chu kỳ. `SKIP LOCKED` bỏ qua bản đang bị khoá; bản đó tự lành ở lượt cron kế tiếp (5 phút sau). Khuôn queue-worker chuẩn PostgreSQL 9.5+.
- **(h) Ngoại lệ migration schema**: chỉ 1 partial unique index; CẤM cột/bảng/CHECK/index `plate_number`.
- **(i) Không đụng** `GateAccessLogService`/`ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/module `anpr`.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
