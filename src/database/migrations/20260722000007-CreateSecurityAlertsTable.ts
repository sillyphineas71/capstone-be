import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Security Alert Center scope — tạo bảng `security_alerts` (UC-121/123/124/129:
 * nhật ký sự cố an ninh + vòng đời xử lý, đã duyệt — xem
 * BAO_CAO_DE_XUAT_3_BANG_ALERT_CENTER.md + PHAN_HOI_DUYET_3_BANG_ALERT_CENTER.md,
 * 2026-07-22).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ — ghi alert, đánh giá rule,
 * acknowledge/resolve làm ở UC-123 sau. Viết TAY (KHÔNG migration:generate). Mirror
 * style 20260721000004-CreateGateAccessLogsTable.ts: uuid_generate_v4(), timestamptz,
 * KHÔNG soft-delete (audit trail).
 *
 * DATA-02: CHỈ CREATE/DROP `security_alerts` + 5 index của nó — KHÔNG đụng bảng khác.
 * Phụ thuộc: `zones`, `iot_device_events`, `alert_rules` (migration 20260722000006),
 * `users`. Chạy SAU `alert_rules` vì có FK `rule_id`.
 *
 * ⚠ TRAP quan trọng nhất (Hải review §1.2): dedup "đang tiếp diễn" (UC-121 EX1 —
 * vượt ngưỡng liên tục = cập nhật `last_seen_at`/`occurrence_count` trên alert đang mở,
 * KHÔNG tạo alert mới) PHẢI LÀ UNIQUE PARTIAL, KHÔNG PHẢI index tra cứu thường.
 * Lý do: pre-check ở tầng code luôn có cửa sổ race — hai event tụ tập đến gần như
 * đồng thời sẽ cùng SELECT không thấy alert mở → cùng INSERT → nhân đôi cảnh báo.
 * Chỉ unique index mới chặn được race ở tầng DB dưới cùng. Tầng service (UC-123 sau)
 * PHẢI bắt lỗi 23505 (mirror `VehicleControlListService.isUniqueViolation`) và chuyển
 * sang nhánh UPDATE `last_seen_at`/`occurrence_count` thay vì ném lỗi ra ngoài.
 *
 * Cũng TÁCH 2 partial unique vì zone_id nullable (mirror bẫy NULL != NULL của
 * `alert_rules`, migration trước).
 */
export class CreateSecurityAlertsTable20260722000007
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "security_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "alert_type" varchar(40) NOT NULL,
        "severity" varchar(20) NOT NULL DEFAULT 'medium',
        "zone_id" uuid,
        "status" varchar(30) NOT NULL DEFAULT 'new',
        "triggered_at" timestamptz NOT NULL,
        "last_seen_at" timestamptz,
        "occurrence_count" integer NOT NULL DEFAULT 1,
        "source_event_id" uuid,
        "rule_id" uuid,
        "payload_json" jsonb,
        "acknowledged_by" uuid,
        "acknowledged_at" timestamptz,
        "resolved_by" uuid,
        "resolved_at" timestamptz,
        "resolution_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_alerts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_security_alerts_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_security_alerts_source_event" FOREIGN KEY ("source_event_id")
          REFERENCES "iot_device_events" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_security_alerts_rule" FOREIGN KEY ("rule_id")
          REFERENCES "alert_rules" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_security_alerts_acknowledged_by" FOREIGN KEY ("acknowledged_by")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_security_alerts_resolved_by" FOREIGN KEY ("resolved_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // Màn hình Trung tâm cảnh báo (UC-123): danh sách mới nhất theo trạng thái.
    await queryRunner.query(`
      CREATE INDEX "IDX_security_alerts_status_time"
        ON "security_alerts" ("status", "triggered_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_security_alerts_zone_time"
        ON "security_alerts" ("zone_id", "triggered_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_security_alerts_type_time"
        ON "security_alerts" ("alert_type", "triggered_at" DESC)
    `);

    // Dedup "đang tiếp diễn" — rule riêng zone (UNIQUE thật, chặn race ở tầng DB).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_zone"
        ON "security_alerts" ("alert_type", "zone_id")
        WHERE "status" <> 'resolved' AND "zone_id" IS NOT NULL
    `);

    // Dedup "đang tiếp diễn" — rule toàn khuôn viên (zone_id NULL, tách riêng vì NULL != NULL).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_security_alerts_open_type_global"
        ON "security_alerts" ("alert_type")
        WHERE "status" <> 'resolved' AND "zone_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_security_alerts_open_type_global"`);
    await queryRunner.query(`DROP INDEX "UQ_security_alerts_open_type_zone"`);
    await queryRunner.query(`DROP INDEX "IDX_security_alerts_type_time"`);
    await queryRunner.query(`DROP INDEX "IDX_security_alerts_zone_time"`);
    await queryRunner.query(`DROP INDEX "IDX_security_alerts_status_time"`);
    await queryRunner.query(`DROP TABLE "security_alerts"`);
  }
}
