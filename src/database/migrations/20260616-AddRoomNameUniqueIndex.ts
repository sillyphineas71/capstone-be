import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoomNameUniqueIndex20260616 implements MigrationInterface {
  name = 'AddRoomNameUniqueIndex20260616';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_rooms_room_name_not_deleted ON rooms (lower(btrim(room_name))) WHERE deleted_at IS NULL;',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ux_rooms_room_name_not_deleted;');
  }
}
