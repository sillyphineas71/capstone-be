import { DataSource } from 'typeorm';

export async function seedMeetingWarningConflictConfig(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into('system_configs')
      .values({
        configKey: 'meeting_warning_conflict_buffer_minutes',
        configValue: '0',
        valueType: 'number',
        configGroup: 'meeting',
        description: 'Buffer window in minutes after meeting end_time for conflict detection. 0 = detect only at exact end_time.',
      })
      .orIgnore()
      .execute();

    await queryRunner.commitTransaction();
  } catch (err) {
    await queryRunner.rollbackTransaction();
    throw err;
  } finally {
    await queryRunner.release();
  }
}
