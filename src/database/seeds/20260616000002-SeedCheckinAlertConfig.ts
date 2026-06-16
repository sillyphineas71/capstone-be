import { DataSource } from 'typeorm';

export async function seedCheckinAlertConfig(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const configs = [
      {
        configKey: 'attendance.checkin_alert.enabled',
        configValue: 'true',
        valueType: 'boolean',
        configGroup: 'attendance',
        description: 'Master toggle cho check-in alert cron job',
      },
      {
        configKey: 'attendance.checkin_alert.grace_minutes',
        configValue: '5',
        valueType: 'number',
        configGroup: 'attendance',
        description: 'Số phút dung sai sau meeting start trước khi gửi cảnh báo',
      },
      {
        configKey: 'attendance.checkin_alert.scan_interval_seconds',
        configValue: '60',
        valueType: 'number',
        configGroup: 'attendance',
        description: 'Tần suất cron job quét (giây)',
      },
      {
        configKey: 'attendance.checkin_alert.channels',
        configValue: '["email"]',
        valueType: 'json',
        configGroup: 'attendance',
        description: 'Danh sách channel được phép gửi cảnh báo',
      },
      {
        configKey: 'attendance.checkin_alert.notify_host_enabled',
        configValue: 'true',
        valueType: 'boolean',
        configGroup: 'attendance',
        description: 'Bật/tắt gửi host summary khi có người chưa check-in',
      },
      {
        configKey: 'attendance.checkin_alert.max_retry_attempts',
        configValue: '3',
        valueType: 'number',
        configGroup: 'attendance',
        description: 'Số lần retry tối đa khi gửi email thất bại',
      },
    ];

    for (const cfg of configs) {
      await queryRunner.query(
        `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active, version_no)
         VALUES ($1, $2, $3, $4, $5, true, 1)
         ON CONFLICT (config_key) DO NOTHING;`,
        [cfg.configKey, cfg.configValue, cfg.valueType, cfg.configGroup, cfg.description],
      );
    }

    await queryRunner.commitTransaction();
    console.log('[Seed] Check-in alert config seeded successfully');
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
