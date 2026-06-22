import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarningScheduledEventTypes20260619000001 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'warning_scheduled'`);
    await queryRunner.query(`ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'warning_scheduling_skipped'`);
    await queryRunner.query(`ALTER TYPE background_job_type ADD VALUE IF NOT EXISTS 'meeting_time_warning'`);
    await queryRunner.query(`ALTER TYPE background_job_status ADD VALUE IF NOT EXISTS 'scheduled'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
  }
}
