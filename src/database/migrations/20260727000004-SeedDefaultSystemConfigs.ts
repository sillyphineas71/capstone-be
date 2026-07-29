import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed gia tri mac dinh cho 9 key phang FE quan tri (SystemSettings.jsx:28-38), theo
 * SYSTEM_CONFIG_ALLOWLIST (src/modules/administration/constants/system-config-allowlist.ts).
 *
 * [PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md T-4.10] Idempotent WHERE NOT EXISTS
 * (KHONG ON CONFLICT — config_key KHONG co unique index tren RDS that, xem
 * SystemConfigService docblock). Neu key da ton tai (vi du do 1 trong cac
 * *-config.service.ts khac da ghi truoc), KHONG ghi de - giu nguyen gia tri hien co.
 *
 * KHONG dung den 5 key co dau cham (no_show.auto_release_enabled,
 * recording.retention_days_default, org.timezone_default,
 * gate_access.closing_hour_local, analytics.dashboard_max_range_days) - 2 he ten
 * doc lap, xem allowlist file.
 */
export class SeedDefaultSystemConfigs20260727000004 implements MigrationInterface {
  name = 'SeedDefaultSystemConfigs20260727000004';

  private readonly entries: Array<{
    key: string;
    value: string;
    valueType: 'boolean' | 'number';
    group: string;
    description: string;
  }> = [
    {
      key: 'is_auto_release_enabled',
      value: 'true',
      valueType: 'boolean',
      group: 'no_show',
      description: 'Bat/tat tu dong giai phong phong khi phat hien no-show',
    },
    {
      key: 'no_show_threshold_minutes',
      value: '10',
      valueType: 'number',
      group: 'no_show',
      description: 'So phut cho truoc khi danh dau no-show',
    },
    {
      key: 'grace_minutes',
      value: '5',
      valueType: 'number',
      group: 'no_show',
      description:
        'Thoi gian an han (dem nguoc canh bao) truoc khi giai phong phong',
    },
    {
      key: 'is_early_release_enabled',
      value: 'true',
      valueType: 'boolean',
      group: 'room_utilization',
      description: 'Bat/tat phat hien phong trong som (early vacancy)',
    },
    {
      key: 'early_departure_threshold_minutes',
      value: '10',
      valueType: 'number',
      group: 'room_utilization',
      description: 'Nguong phut de phat hien phong trong som',
    },
    {
      key: 'is_host_warning_enabled',
      value: 'true',
      valueType: 'boolean',
      group: 'meeting',
      description: 'Bat/tat canh bao cho host khi cuoc hop co van de',
    },
    {
      key: 'recording_retention_days',
      value: '90',
      valueType: 'number',
      group: 'recording',
      description: 'So ngay luu tru file ghi am/ghi hinh truoc khi xoa',
    },
    {
      key: 'is_recording_consent_required',
      value: 'true',
      valueType: 'boolean',
      group: 'recording',
      description: 'Bat buoc xin su dong y truoc khi ghi am/ghi hinh',
    },
    {
      key: 'overrun_grace_minutes',
      value: '10',
      valueType: 'number',
      group: 'meeting',
      description: 'Thoi gian an han (phut) truoc khi coi cuoc hop la qua gio',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_sensitive, is_active, version_no)
         SELECT $1::varchar, $2::text, $3::varchar, $4::varchar, $5::text, false, true, 1
         WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1);`,
        [e.key, e.value, e.valueType, e.group, e.description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const keys = this.entries.map((e) => e.key);
    await queryRunner.query(
      `DELETE FROM system_configs WHERE config_key = ANY($1);`,
      [keys],
    );
  }
}
