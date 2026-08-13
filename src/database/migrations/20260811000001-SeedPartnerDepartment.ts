import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedPartnerDepartment20260811000001 implements MigrationInterface {
  name = 'SeedPartnerDepartment20260811000001';

  private readonly partnerDepartmentId = '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO departments (id, department_code, department_name, is_active)
       SELECT $1::uuid, 'PARTNER', '\u0110\u1ed1i t\u00e1c', true
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE id = $1);`,
      [this.partnerDepartmentId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM departments WHERE id = $1 AND department_code = 'PARTNER';`,
      [this.partnerDepartmentId],
    );
  }
}
