import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountExpiresAtToUsers20260811000000
  implements MigrationInterface
{
  name = 'AddAccountExpiresAtToUsers20260811000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_expires_at timestamptz NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS account_expires_at;`,
    );
  }
}