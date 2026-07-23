import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GAP-001 / UC-106 — partial unique index `UQ_gate_logs_paired` tren `gate_access_logs`.
 *
 * ⚠ NGOAI LE co chu dich (QĐ-4): 9 UC truoc chi seed permission (no-migration-schema). UC-106
 * duoc tao DUY NHAT index nay vi day la RANG BUOC TOAN VEN DU LIEU (thuoc schema, khong phai
 * logic): chan hai ban ghi khac nhau cung tro toi mot `paired_log_id`. Cung `FOR UPDATE
 * SKIP LOCKED` la 2 lop chong ghep trung (pre-check tang code luon co cua so race — chi unique
 * index moi dong duoc, bai hoc UQ_zones_code_active o UC-90).
 *
 * Partial (WHERE paired_log_id IS NOT NULL): nhieu ban chua ghep (NULL) khong bi chan; chi chan
 * hai ban khac nhau cung tro 1 paired_log_id. Vi UC-106 ghep HAI CHIEU (leave<->enter), index
 * chan ca hai `leave` nhan 1 `enter` LAN hai `enter` nhan 1 `leave`.
 *
 * ⚠⚠ RUI RO KHI AP LEN MOI TRUONG CO DU LIEU: `CREATE UNIQUE INDEX` **FAIL** neu bang dang co
 * >=2 ban trung `paired_log_id`. Bang hien RONG (writer UC-105 chua xay) nen local an toan.
 * Nguoi ap len RDS phai kiem truoc:
 *   SELECT paired_log_id, count(*) FROM gate_access_logs
 *   WHERE paired_log_id IS NOT NULL GROUP BY paired_log_id HAVING count(*) > 1;
 *
 * KHONG them cot/bang/CHECK/index khac. Mirror style 20260721000001-CreateZonesTable.ts.
 */
export class AddGateLogsPairedUniqueIndex20260722000008 implements MigrationInterface {
  name = 'AddGateLogsPairedUniqueIndex20260722000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gate_logs_paired"
        ON "gate_access_logs" ("paired_log_id") WHERE "paired_log_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_gate_logs_paired"`);
  }
}
