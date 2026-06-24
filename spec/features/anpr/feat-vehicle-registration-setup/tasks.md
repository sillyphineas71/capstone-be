# VRS-001 — tasks.md (Setup-0 ANPR: entity VehicleRegistration + migration)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VRS-001: T0 gate `migration:show` (nhánh xấu→DỪNG) → T1 entity → T2 module/wiring → T3 migration viết tay → T-GATE STOP. Mỗi task 1 AC. Schema-only, rào chắn DATA-02. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Schema-only (DATA-02/ARCH-01). Migration viết tay, KHÔNG tự `migration:run`.

## Thứ tự
T0 → T1 → T1b → T2 → T3 → T-GATE.

---

## T0 — Gate `migration:show` (RECON ledger, nhánh xấu→DỪNG) — plan §2, R2/R3
- Người vận hành chạy `npm run migration:show` trên dev DB (máy agent KHÔNG có DB → KHÔNG giả định nhánh sạch), dán kết quả.
- Phân nhánh: (a) 4 migration cũ `[X]` → đi tiếp; (b) `[ ]` mà bảng baseline đã tồn tại (dump) → **DỪNG báo Thiếu Chủ, KHÔNG fake-run / KHÔNG đánh dấu ledger**.
- **AC**: dán output `migration:show`; nhánh (a) mới được sang T1; nhánh (b) → DỪNG.

## T1 — Entity `VehicleRegistrationEntity` (code) — plan §4, spec §3
- `src/modules/anpr/entities/vehicle-registration.entity.ts` mirror `device-user-mapping.entity.ts`: `@Entity('vehicle_registrations')`, `@PrimaryGeneratedColumn('uuid') id`; cột `user_id`(uuid), `plate_number`(varchar 16), `plate_raw`(varchar 20), `vehicle_type`(varchar 50, nullable), `note`(varchar 255, nullable), `status`(varchar 30, default 'active'); `@CreateDateColumn`/`@UpdateDateColumn`/`@DeleteDateColumn` (timestamptz); relation `@ManyToOne(()=>UserEntity,{onDelete:'CASCADE'}) @JoinColumn({name:'user_id'}) user`. KHÔNG field ngoài schema.
- **AC**: entity khớp 100% bảng §2; build resolve; 0 service/controller/DTO.

## T1b — Entity load/DI-proof (verify)
- `forFeature([VehicleRegistrationEntity])` đăng ký; AppModule compile (DI-proof throwaway; Redis infra-OK; 0 circular/UnknownDependencies); xóa file proof sau.
- **AC**: AppModule compile, 0 circular/UnknownDependencies.

## T2 — Module `anpr` + wiring (code) — plan §4
- `src/modules/anpr/anpr.module.ts`: `imports:[TypeOrmModule.forFeature([VehicleRegistrationEntity])]`, `exports:[TypeOrmModule]`; KHÔNG provider/controller/service.
- `src/app.module.ts`: import + `AnprModule` vào `imports` (mirror IotModule/IvssModule).
- **AC**: app khởi động (DI) không lỗi; AnprModule nạp; vẫn 0 service/controller.

## T3 — Migration VIẾT TAY (code, KHÔNG run) — plan §3, R4/R5/DATA-02
- `src/database/migrations/<timestamp>-CreateVehicleRegistrationsTable.ts` (timestamp > 4 file cũ), `MigrationInterface` up/down, mirror `1716800000000-CreateIotDevicesTable.ts`.
- `up`: `CREATE TABLE vehicle_registrations` (cột §2, `uuid_generate_v4()`, `timestamptz`, PK đặt tên, FK→users ON DELETE CASCADE) + partial unique `UQ_vehicle_plate_number_active (plate_number) WHERE deleted_at IS NULL` + `IDX_vehicle_registrations_user_id (user_id)`. `down`: DROP 2 index + DROP table.
- **CHỈ** chạm `vehicle_registrations` + 2 index — KHÔNG ALTER/DROP bảng khác (DATA-02). KHÔNG `migration:generate`. **KHÔNG tự `migration:run`.**
- **AC**: file migration hợp lệ (up/down build OK); SQL chỉ tạo/xóa `vehicle_registrations` + 2 index; KHÔNG đụng bảng khác.

## T-GATE — (STOP, KHÔNG commit, KHÔNG run migration) — plan §7
- build=0; eslint touched (entity + module + migration) + baseline-proof (stash `app.module.ts`) 0 rule mới, file mới 0; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG `migration:run`.**
- **STOP**: trình up/down SQL + diff 4 file → chờ Thiếu Chủ duyệt → execute lượt riêng.
- **Owed (ghi, KHÔNG chạy)**: T0 `migration:show` trên dev DB (người vận hành) · `migration:run` sau duyệt + verify AC#1/#3 (up/down + partial-unique insert-trùng/soft-delete-insert-lại) trên dev DB · xác nhận `uuid-ossp` lúc run.
- **AC**: bảng gate đầy đủ + báo cáo: schema-only (0 service/controller/DTO — ARCH-01) · migration chỉ chạm bảng mới (DATA-02) · viết tay không generate · entity mirror · DI-proof. STOP.

## Map task → scope Setup-0
- T0 → gate ledger (R2/R3) trước khi đụng migration
- T1/T1b → entity `VehicleRegistrationEntity` + DI
- T2 → module `anpr` + wiring app.module
- T3 → migration viết tay (bảng mới + 2 index, DATA-02)
- T-GATE → gate + STOP trình up/down chờ duyệt (R5) + Owed (run + verify trên dev DB)
