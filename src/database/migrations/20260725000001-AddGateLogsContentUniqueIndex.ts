import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GAW-001 / UC-105 — partial unique index `UQ_gate_logs_content` tren `gate_access_logs`.
 *
 * ⚠ NGOAI LE co chu dich (QC-1): UC-105 la writer, can chong TRUNG khi bridge gui lai cung
 * su kien (retry). Khoa bat bien lay tu DU LIEU THIET BI (`zone_id` + `plate_number` +
 * `direction` + `access_time`, trong do `access_time` suy tu `evt.utc` — KHONG `now()`),
 * KHONG lay tu id do DB sinh (phuong an unique tren `event_id` DA BI LOAI: retry sinh raw
 * event id moi nen khong phat hien trung — spec §8.4).
 *
 * Partial (WHERE plate_number IS NOT NULL): dong `plate_number` NULL/rong khong duoc bao ve
 * — chap nhan co chu dich (dong do dep khong ghep cap duoc: QĐ-5 + UC-106 loc user_id NOT NULL).
 * `23505` khi va cham → writer bo qua lang (QC-1), UPDATE payload gateLogSkipped='duplicate'.
 *
 * ⚠⚠ RUI RO KHI AP LEN MOI TRUONG CO DU LIEU: `CREATE UNIQUE INDEX` **FAIL** neu bang dang co
 * >=2 dong trung bo 4 khoa (voi plate_number NOT NULL). Bang hien RONG (writer chua bat) nen
 * local an toan. Nguoi ap len RDS phai kiem truoc:
 *   SELECT zone_id, plate_number, direction, access_time, count(*)
 *   FROM gate_access_logs WHERE plate_number IS NOT NULL
 *   GROUP BY zone_id, plate_number, direction, access_time HAVING count(*) > 1;
 *
 * KHONG them cot/bang/CHECK/index khac. Mirror style 20260722000008-AddGateLogsPairedUniqueIndex.ts.
 */
export class AddGateLogsContentUniqueIndex20260725000001 implements MigrationInterface {
  name = 'AddGateLogsContentUniqueIndex20260725000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gate_logs_content"
        ON "gate_access_logs" ("zone_id", "plate_number", "direction", "access_time")
        WHERE "plate_number" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_gate_logs_content"`);
  }
}
