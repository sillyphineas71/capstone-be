import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDepartmentUniqueIndexes20260608025416 implements MigrationInterface {
  name = 'AddDepartmentUniqueIndexes20260608025416';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_code ON departments (department_code) WHERE deleted_at IS NULL;',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_departments_name ON departments (department_name) WHERE deleted_at IS NULL;',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ux_departments_code;');
    await queryRunner.query('DROP INDEX IF EXISTS ux_departments_name;');
  }
}
