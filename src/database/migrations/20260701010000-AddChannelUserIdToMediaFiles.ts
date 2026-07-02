import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelUserIdToMediaFiles20260701010000 implements MigrationInterface {
  name = 'AddChannelUserIdToMediaFiles20260701010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE media_files ADD COLUMN channel_user_id uuid NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_media_files_channel_user_id ON media_files (channel_user_id) WHERE channel_user_id IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE media_files ADD CONSTRAINT fk_media_files_channel_user FOREIGN KEY (channel_user_id) REFERENCES users(id) ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE media_files DROP CONSTRAINT IF EXISTS fk_media_files_channel_user`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_media_files_channel_user_id`,
    );
    await queryRunner.query(
      `ALTER TABLE media_files DROP COLUMN IF EXISTS channel_user_id`,
    );
  }
}
