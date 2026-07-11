import { DataSource } from 'typeorm';

export async function seedMeetingWarningConfig(
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
        configKey: 'meeting_warning_before_minutes',
        configValue: '10',
        valueType: 'number',
        configGroup: 'meeting',
        description:
          'Minutes before meeting end_time to schedule warning notification',
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
