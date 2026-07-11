import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarningScheduledEventTypes20260619000001 implements MigrationInterface {
  public transaction = false;

  // DB v3.2 Compact stores event_type/job_type/job_status as varchar (no CHECK
  // constraint), not native Postgres enums — this migration predates that baseline.
  // Guard each ALTER TYPE so it's a safe no-op on schemas where the enum type
  // was never created (the varchar column already accepts these string values).
  private async addEnumValueIfTypeExists(
    queryRunner: QueryRunner,
    typeName: string,
    value: string,
  ): Promise<void> {
    const exists: Array<{ exists: boolean }> = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = $1) AS exists`,
      [typeName],
    );
    if (!exists[0]?.exists) {
      return;
    }
    await queryRunner.query(
      `ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS '${value}'`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addEnumValueIfTypeExists(
      queryRunner,
      'meeting_event_type',
      'warning_scheduled',
    );
    await this.addEnumValueIfTypeExists(
      queryRunner,
      'meeting_event_type',
      'warning_scheduling_skipped',
    );
    await this.addEnumValueIfTypeExists(
      queryRunner,
      'background_job_type',
      'meeting_time_warning',
    );
    await this.addEnumValueIfTypeExists(
      queryRunner,
      'background_job_status',
      'scheduled',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
