import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoomIdToIotDevices1716800000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "iot_devices" ADD "room_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "iot_devices" DROP COLUMN "room_id"
    `);
  }
}
