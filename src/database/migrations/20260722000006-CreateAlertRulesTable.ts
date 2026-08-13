import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Security Alert Center scope — tạo bảng `alert_rules` (UC-122: Cấu hình quy tắc
 * cảnh báo, phương án A đã duyệt — xem BAO_CAO_DE_XUAT_3_BANG_ALERT_CENTER.md +
 * PHAN_HOI_DUYET_3_BANG_ALERT_CENTER.md, 2026-07-22).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ — CRUD + validate ngưỡng làm ở
 * UC-122 sau. Viết TAY (KHÔNG migration:generate). Mirror style
 * 20260721000006-CreateVehicleControlListTable.ts: uuid_generate_v4(), timestamptz,
 * soft-delete, partial unique index.
 *
 * DATA-02: CHỈ CREATE/DROP `alert_rules` + 3 index của nó — KHÔNG đụng bảng khác.
 *
 * ⚠ TRAP đã được Hải chỉ ra ở review (§1.1): SQL coi NULL != NULL, nên
 * `UNIQUE(alert_type, zone_id) WHERE deleted_at IS NULL` KHÔNG chặn được nhiều rule
 * mặc định (zone_id NULL) trùng alert_type. Phải TÁCH 2 partial unique:
 * - rule riêng theo zone: UNIQUE (alert_type, zone_id) WHERE zone_id IS NOT NULL
 * - rule mặc định toàn khuôn viên: UNIQUE (alert_type) WHERE zone_id IS NULL
 * `zone_id` không NULL = override rule mặc định cho zone đó (UC-122 BR2).
 *
 * `restricted_hours_json` + `allowed_person_ids_json` phục vụ UC-124 (xâm nhập khu vực
 * hạn chế): khung giờ cho phép + danh sách người được vào. `allowed_person_ids_json` là
 * mảng user_id KHÔNG có FK (residual đã ghi rõ trong báo cáo review — chấp nhận cho
 * scope này, tách bảng nối `alert_rule_allowed_persons` sau nếu cần truy vấn ngược).
 *
 * Timestamp migration lấy SAU 20260722000005 (5 permission zone của Hải) theo đúng yêu
 * cầu review §4.3.
 */
export class CreateAlertRulesTable20260722000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "alert_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "alert_type" varchar(40) NOT NULL,
        "zone_id" uuid,
        "threshold" integer,
        "channels" jsonb NOT NULL DEFAULT '["in_app"]',
        "enabled" boolean NOT NULL DEFAULT true,
        "restricted_hours_json" jsonb,
        "allowed_person_ids_json" jsonb,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_alert_rules_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_alert_rules_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_alert_rules_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_alert_rules_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Rule riêng theo zone: mỗi (loại, zone) chỉ 1 rule sống.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_alert_rules_type_zone_active"
        ON "alert_rules" ("alert_type", "zone_id")
        WHERE "deleted_at" IS NULL AND "zone_id" IS NOT NULL
    `);

    // Rule mặc định toàn khuôn viên: mỗi loại chỉ 1 rule sống.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_alert_rules_type_global_active"
        ON "alert_rules" ("alert_type")
        WHERE "deleted_at" IS NULL AND "zone_id" IS NULL
    `);

    // Hot path: đánh giá rule đang bật theo loại sự kiện.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_alert_rules_lookup"
        ON "alert_rules" ("alert_type")
        WHERE "deleted_at" IS NULL AND "enabled" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_alert_rules_lookup"`);
    await queryRunner.query(`DROP INDEX "UQ_alert_rules_type_global_active"`);
    await queryRunner.query(`DROP INDEX "UQ_alert_rules_type_zone_active"`);
    await queryRunner.query(`DROP TABLE "alert_rules"`);
  }
}
