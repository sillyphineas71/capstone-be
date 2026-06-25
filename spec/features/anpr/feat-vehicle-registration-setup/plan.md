# VRS-001 — plan.md (Setup-0 ANPR: entity VehicleRegistration + migration)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VRS-001 sau spec DUYỆT. Gate `migration:show` đầu (nhánh xấu→DỪNG). Migration VIẾT TAY (không generate). Bảng mới `vehicle_registrations` + entity + module `anpr`. Schema-only, rào chắn DATA-02. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ. Tasks: [tasks.md](./tasks.md).

## 0. Crux — pipeline migration vs baseline-từ-dump (RECON code thật, KẾT LUẬN)
Đọc [package.json](../../../../package.json) (scripts `migration:run/generate/revert/show`) + [data-source.ts](../../../../src/database/data-source.ts) (`synchronize:false`, glob entity/migration, ledger `typeorm_migrations`) + [1716800000000-CreateIotDevicesTable.ts](../../../../src/database/migrations/1716800000000-CreateIotDevicesTable.ts) (pattern up/down + partial unique).
- **Pipeline CHẠY ĐƯỢC** về cơ chế.
- NHƯNG baseline 39 bảng KHÔNG do migration dựng (chỉ 4 file migration; còn lại từ SQL dump gitignored) → **ledger `typeorm_migrations` chưa kiểm được từ máy agent**.

**KẾT LUẬN**: thêm bảng MỚI `vehicle_registrations` là ca an toàn nhất (không có trong dump → không collision với baseline). NHƯNG nếu chạy `migration:run` khi ledger nhánh (4 migration cũ = `[ ]` mà bảng đã tồn tại) → TypeORM cố chạy lại migration cũ → collision "table already exists". ⇒ **task gate 0 `migration:show` BẮT BUỘC trước khi tạo/chạy migration**; nhánh xấu → DỪNG báo người, KHÔNG tự fake-run. Migration **viết tay** (KHÔNG `generate` — tránh sinh ALTER rác cho 39 bảng baseline khi entity-vs-DB lệch).

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 module `anpr` (table `vehicle_registrations`) · OQ-2 pipeline thật + `migration:show` gate đầu + viết tay · OQ-3 `plate_number varchar(16)` / `plate_raw varchar(20)`.
- **DATA-01** ngoại lệ no-migration ĐÃ DUYỆT (Phương án A) — KHÔNG phải vi phạm.
- **DATA-02** migration chỉ CREATE/DROP `vehicle_registrations` + 2 index của nó; KHÔNG ALTER/DROP bảng khác.
- **ARCH-01** schema-only: 0 service/controller/DTO.
- **SEC** N/A (không bề mặt bảo mật mới ở Setup-0; quyền/validate = UC1+).

## 2. Task gate 0 — `migration:show` (RECON ledger, TRƯỚC khi viết migration)
- Người vận hành chạy `npm run migration:show` trên dev DB (máy agent KHÔNG có DB → agent KHÔNG giả định nhánh sạch), dán kết quả. Phân nhánh:
  - **(a) sạch**: 4 migration cũ = `[X]` → đi tiếp T1+.
  - **(b) lệch nguy hiểm**: `[ ]` mà bảng baseline đã tồn tại (từ dump) → **DỪNG, báo Thiếu Chủ. KHÔNG fake-run, KHÔNG đánh dấu ledger.** Chờ quyết (fake-run thủ công / `CREATE TABLE IF NOT EXISTS` / cách khác).

## 3. Migration viết tay — `vehicle_registrations` + 2 index
File: `src/database/migrations/<timestamp>-CreateVehicleRegistrationsTable.ts` (timestamp > 4 file cũ; mirror §0.3 IPS-pattern).

### up() — trình review TRƯỚC khi execute
```sql
CREATE TABLE "vehicle_registrations" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "user_id" uuid NOT NULL,
  "plate_number" varchar(16) NOT NULL,
  "plate_raw" varchar(20) NOT NULL,
  "vehicle_type" varchar(50),
  "note" varchar(255),
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "PK_vehicle_registrations_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_vehicle_registrations_user" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "UQ_vehicle_plate_number_active"
  ON "vehicle_registrations" ("plate_number") WHERE "deleted_at" IS NULL;
CREATE INDEX "IDX_vehicle_registrations_user_id"
  ON "vehicle_registrations" ("user_id");
```
### down()
```sql
DROP INDEX "IDX_vehicle_registrations_user_id";
DROP INDEX "UQ_vehicle_plate_number_active";
DROP TABLE "vehicle_registrations";
```
Micro-decisions (gật khi review): `vehicle_type varchar(50)` / `note varchar(255)` nullable · `plate_raw` NOT NULL · FK `ON DELETE CASCADE`.

## 4. Entity + module + wiring
- `src/modules/anpr/entities/vehicle-registration.entity.ts` — mirror device-user-mapping (§0.4): cột snake_case, `@CreateDateColumn`/`@UpdateDateColumn`/`@DeleteDateColumn`, `@ManyToOne(()=>UserEntity,{onDelete:'CASCADE'}) @JoinColumn({name:'user_id'})`.
- `src/modules/anpr/anpr.module.ts` — `forFeature([VehicleRegistrationEntity])`, `exports:[TypeOrmModule]`; KHÔNG provider/controller.
- `src/app.module.ts` — import + `AnprModule` vào `imports` (mirror IotModule/IvssModule, import extensionless như app.module hiện dùng).

## 5. File list
### Net-new
- `src/database/migrations/<ts>-CreateVehicleRegistrationsTable.ts`
- `src/modules/anpr/entities/vehicle-registration.entity.ts`
- `src/modules/anpr/anpr.module.ts`
### Modified
- `src/app.module.ts` — nạp `AnprModule`.
> Tổng **4 file**. 0 service/controller/DTO/seed. 0 bảng/migration khác bị đụng (DATA-02).

## 6. Test / Verify (KHÔNG đụng DB ở lượt code)
- DI-proof: compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies; `forFeature` resolve). Throwaway, xóa sau.
- DB behavior (AC#1/#3 — lượt riêng sau execute trên dev DB): up tạo bảng+2 index; down xóa sạch; partial unique (insert trùng→chặn; soft-delete→insert lại OK).

## 7. Gate (STOP, KHÔNG commit / KHÔNG run migration)
- build=0; eslint touched (entity + module + migration) + spec baseline-proof **0 rule mới**, file mới 0; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG `migration:run`** trong lượt code — **STOP, trình up/down SQL + diff 4 file** → chờ duyệt → execute lượt riêng.
- **Owed (ghi, KHÔNG chạy)**: task gate 0 `migration:show` trên dev DB (người vận hành) · execute `migration:run` sau duyệt + verify AC#1/#3 trên dev DB · xác nhận `uuid-ossp` có sẵn lúc run.

## 8. Kỷ luật
- **DATA-01** ngoại lệ no-migration đã duyệt (KHÔNG phải vi phạm); **DATA-02** chỉ chạm bảng mới — `ALTER`/`DROP` bảng khác → DỪNG; **ARCH-01** schema-only (0 service/controller/DTO); **SEC** N/A (Setup-0 không bề mặt bảo mật).
- Migration **viết tay** (không `generate`); **KHÔNG tự `migration:run`** — chờ duyệt up/down + diff.
- env/route: Setup-0 không env mới, không route.

> **STOP.** Plan + tasks chờ review trước khi code.
