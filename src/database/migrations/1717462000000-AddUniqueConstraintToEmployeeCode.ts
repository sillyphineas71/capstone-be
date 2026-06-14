import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueConstraintToEmployeeCode1717462000000 implements MigrationInterface {
  name = 'AddUniqueConstraintToEmployeeCode1717462000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_unique 
      ON users (employee_code) 
      WHERE employee_code IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_users_employee_code_unique;
    `);
  }
}
