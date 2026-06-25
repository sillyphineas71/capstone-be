# VRS-001 — Setup-0 (ANPR): entity VehicleRegistration + migration bảng `vehicle_registrations`

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VRS-001 (Setup-0): bảng mới `vehicle_registrations` (biển↔user 1-nhiều) + entity + module `anpr`. Ngoại lệ no-migration ĐƯỢC DUYỆT (Phương án A). RECON pipeline migration code thật. OQ đã chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa code/migration. Tiền đề mini-epic ANPR (UC1–UC7). **Chỉ dựng schema, KHÔNG logic nghiệp vụ** (normalize/resolve/đăng-ký = UC sau). Plan: [plan.md](./plan.md), Tasks: [tasks.md](./tasks.md).

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Pipeline migration — scripts CÓ THẬT ([package.json](../../../../package.json))
- `migration:run` = `typeorm migration:run -d src/database/data-source.ts`; tương tự `migration:generate` / `migration:revert` / `migration:show`. Runner `typeorm-ts-node-commonjs`. ⇒ pipeline chạy được, KHÔNG phải dựng mới.

### 0.2. DataSource CLI ([data-source.ts](../../../../src/database/data-source.ts))
- `synchronize: false` (luôn), `entities: modules/**/*.entity.{ts,js}`, `migrations: ./migrations/*.{ts,js}`, ledger `migrationsTableName: 'typeorm_migrations'`. ⇒ entity mới tự được nạp qua glob; file migration mới tự vào danh sách.

### 0.3. Pattern migration mirror ([1716800000000-CreateIotDevicesTable.ts](../../../../src/database/migrations/1716800000000-CreateIotDevicesTable.ts))
- `MigrationInterface` up/down, raw `queryRunner.query`. Dùng `uuid_generate_v4()`, `timestamptz`, PK đặt tên (`PK_...`), **partial unique index** mẫu: `CREATE UNIQUE INDEX ... WHERE "mac_address" IS NOT NULL`. ⇒ cột trap `plate_number WHERE deleted_at IS NULL` mirror trực tiếp; `uuid-ossp` đã có (migration cũ dùng được).

### 0.4. Entity mirror ([device-user-mapping.entity.ts](../../../../src/modules/iot/entities/device-user-mapping.entity.ts))
- `@Entity('...')`, `@PrimaryGeneratedColumn('uuid')`, cột snake_case qua `name:`, `@CreateDateColumn`/`@UpdateDateColumn`/`@DeleteDateColumn` (timestamptz) = soft-delete, `@ManyToOne(()=>UserEntity,{onDelete:'CASCADE'}) @JoinColumn`. ⇒ `VehicleRegistrationEntity` mirror trực tiếp.

### 0.5. ⚠ Baseline 39 bảng KHÔNG do migration dựng (crux rủi ro OQ-2)
- Chỉ 4 file migration (`iot_devices`, `room_id`, `employee_code`, `department_indexes`); KHÔNG file nào tạo `users`/`meetings`/`rooms`… ⇒ baseline đến từ **SQL dump** `capstone_db_v3_2_compact_39_tables.sql` (gitignored). Ledger `typeorm_migrations` chưa kiểm được từ máy agent (không có DB). Hệ quả vào OQ-2 + task gate.

---

## 1. Scope (Setup-0)

### TRONG scope
1. Migration **viết tay** tạo `vehicle_registrations` + partial unique `plate_number` (WHERE deleted_at NULL) + index `user_id`.
2. Entity `VehicleRegistrationEntity` khớp schema, mirror `device-user-mapping.entity.ts`.
3. Module `anpr` + `TypeOrmModule.forFeature([VehicleRegistrationEntity])` + nạp vào `app.module.ts`.

### NGOÀI scope (UC sau)
- KHÔNG service/controller/DTO (UC1+). KHÔNG normalize biển (UC1/UC4). KHÔNG bridge/ingestion/webhook. KHÔNG seed dữ liệu.

## 2. Bảng `vehicle_registrations` (khóa thiết kế — đã chốt)
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | uuid PK | `uuid_generate_v4()` |
| `user_id` | uuid FK→users(id) ON DELETE CASCADE | 1 user → nhiều biển (KHÔNG unique) |
| `plate_number` | varchar(16) NOT NULL | normalized; **cột trap** — partial unique WHERE deleted_at NULL |
| `plate_raw` | varchar(20) NOT NULL | biển gốc user nhập (hiển thị) |
| `vehicle_type` | varchar(50) nullable | giữ |
| `note` | varchar(255) nullable | giữ |
| `status` | varchar(30) NOT NULL DEFAULT `'active'` | bỏ duyệt |
| `created_at`/`updated_at`/`deleted_at` | timestamptz | soft-delete mirror face |

- **Partial unique**: `plate_number` WHERE `deleted_at IS NULL` — chặn trùng giữa biển ĐANG SỐNG; cho đăng ký lại sau xóa-mềm. (Unique cứng nguyên cột sẽ kẹt khi xóa-mềm rồi muốn dùng lại.)
- **Index**: `user_id` (lookup biển theo user).

## 3. Entity `VehicleRegistrationEntity`
`src/modules/anpr/entities/vehicle-registration.entity.ts` — mirror §0.4: cột map đúng snake_case, soft-delete 3 cột thời gian, relation `@ManyToOne(()=>UserEntity,{onDelete:'CASCADE'}) user`. KHÔNG field ngoài schema.

## 4. Module `anpr` + wiring
- `src/modules/anpr/anpr.module.ts`: `forFeature([VehicleRegistrationEntity])`, `exports:[TypeOrmModule]`. KHÔNG controller/service/provider.
- `src/app.module.ts`: import + đưa `AnprModule` vào `imports` (mirror IotModule/IvssModule).

## 5. Requirements (EARS)
- **R1 (ubiquitous)**: Hệ thống PHẢI có bảng `vehicle_registrations` với partial unique `plate_number` WHERE `deleted_at IS NULL` và index `user_id`.
- **R2 (event)**: **WHEN** `migration:show` cho thấy 4 migration cũ = `[X]` (ledger sạch) → tiến hành viết + (sau duyệt) chạy migration mới.
- **R3 (unwanted)**: **IF** `migration:show` ra `[ ]` mà bảng baseline đã tồn tại (từ dump) → hệ thống/agent PHẢI DỪNG, báo Thiếu Chủ, **KHÔNG tự fake-run / KHÔNG tự đánh dấu ledger**.
- **R4 (unwanted)**: **IF** cân nhắc `migration:generate` → **KHÔNG dùng** (sinh ALTER rác cho 39 bảng baseline) → migration PHẢI viết tay (chỉ CREATE TABLE + 2 index).
- **R5 (event)**: **WHEN** viết xong file migration → **KHÔNG tự `migration:run`** → trình up/down SQL + diff → chờ Thiếu Chủ duyệt rồi mới execute.
- **R6 (state)**: **WHILE** ở Setup-0, hệ thống PHẢI KHÔNG tạo file service/controller/DTO nào (schema-only).
- **R7 (unwanted)**: **IF** migration cần `ALTER`/`DROP` bất kỳ bảng nào khác `vehicle_registrations` → DỪNG (vi phạm rào chắn DATA-02).

## 6. Test / Verify (KHÔNG đụng DB ở lượt code)
- **Entity/DI**: `forFeature` đăng ký không lỗi; AppModule compile (DI-proof; Redis infra-OK; 0 circular/UnknownDependencies).
- **DB behavior (lượt riêng, sau duyệt + execute trên dev DB)**: `up` tạo đúng bảng + 2 index; `down` xóa sạch; partial unique — insert 2 biển trùng (cùng normalized) → row 2 bị chặn, soft-delete row 1 → insert lại OK.

## 7. Constitution
- **DATA-01 — ngoại lệ no-migration CÓ CHỦ ĐÍCH (đã duyệt)**: epic IVSS giữ no-migration; ANPR Setup-0 **cố ý** tạo bảng mới `vehicle_registrations` (Phương án A, Thiếu Chủ duyệt) vì biển↔user là quan hệ riêng. Đây là **ngoại lệ được phê duyệt, KHÔNG phải vi phạm**.
- **DATA-02 — rào chắn migration**: migration chỉ `CREATE`/`DROP` `vehicle_registrations` + 2 index của nó; **KHÔNG `ALTER`/`DROP` bảng khác**.
- **ARCH-01 — schema-only**: 0 service/controller/DTO/seed. Diff chỉ chạm migration + entity + module (+ app.module).
- **SEC — N/A (có lý do)**: Setup-0 chỉ dựng schema, không endpoint/không xử lý input/không dữ liệu nhạy cảm runtime ⇒ không có bề mặt bảo mật mới. (Quyền đọc/ghi biển, validate input = UC1+, sẽ có SEC riêng.)

## 8. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 tên module**: **`anpr`** (đã chốt) — khớp tên feature khách + epic; table `vehicle_registrations` domain-accurate. (vs `vehicle` [bị loại].)
- **OQ-2 (crux) migration pipeline**: pipeline **CÓ THẬT** (§0.1/0.2/0.3) nhưng baseline từ dump (§0.5) → **đã chốt**: `migration:show` là **task gate đầu** (R2/R3); migration **viết tay** (R4). (vs `generate` [bị loại].)
- **OQ-3 độ dài `plate_number`**: **`varchar(16)`** (đã chốt) — biển VN normalize ~9-10 ký tự (`99MD123456`), 16 dư an toàn; `plate_raw varchar(20)` ổn.

## 9. Residuals / known-gaps
- **Ledger owed**: kết quả `migration:show` chỉ có khi chạy trên dev DB (cần điện/DB) → task gate 0 do người vận hành chạy + dán; agent KHÔNG giả định nhánh sạch.
- **DB-behavior verify owed**: AC partial-unique (insert trùng/soft-delete-rồi-insert-lại) chỉ chứng minh sau khi execute migration trên dev DB (lượt riêng).
- **uuid-ossp**: giả định có sẵn (migration cũ dùng `uuid_generate_v4()`); nếu thiếu, `run` sẽ lộ → xử lúc đó, KHÔNG tự `CREATE EXTENSION` ngoài scope.
- Micro-decision chờ gật khi review: `vehicle_type varchar(50)`/`note varchar(255)` (design ghi "varchar" trống length) · `plate_raw` NOT NULL · FK `ON DELETE CASCADE`.
- Normalize/resolve/CRUD biển = UC1+ (ngoài Setup-0).

> **STOP.** Spec-only. OQ đã chốt; chờ Thiếu Chủ review vỏ + nội dung trước khi qua plan/tasks → code.
