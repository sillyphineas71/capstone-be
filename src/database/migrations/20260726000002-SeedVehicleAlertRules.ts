import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed default alert_rules cho 3 alert_type vehicle cua feature anpr-unauthorized-vehicle-alert
 * (UC-108, ANPR-ALERT-001, Canh bao xe khong co quyen).
 * Tao rule mac dinh toan khuon vien (zone_id = NULL) cho moi alert_type:
 * - vehicle_control_match: bien so trong blocklist/watchlist
 * - unknown_vehicle: bien so khong co registration
 * - vehicle_authorized: bien so co registration pending/rejected
 * Tat ca enabled=true, channels=['in_app'].
 * Idempotent: dung UNIQUE(alert_type) WHERE zone_id IS NULL de tranh trung.
 */
export class SeedVehicleAlertRules20260726000002 implements MigrationInterface {
  name = 'SeedVehicleAlertRules20260726000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rules = [
      {
        alertType: 'vehicle_control_match',
        description: 'Bien so khop vehicle_control_list (blocklist/watchlist)',
      },
      {
        alertType: 'unknown_vehicle',
        description: 'Bien so khong co vehicle_registrations active',
      },
      {
        alertType: 'vehicle_unauthorized',
        description: 'Bien so co registration pending/rejected',
      },
    ];

    for (const rule of rules) {
      await queryRunner.query(
        `INSERT INTO alert_rules (alert_type, zone_id, channels, enabled, threshold)
         SELECT $1::varchar, NULL, $2::jsonb, true, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM alert_rules
           WHERE alert_type = $1 AND zone_id IS NULL AND deleted_at IS NULL
         );`,
        [rule.alertType, JSON.stringify(['in_app'])],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE alert_rules SET deleted_at = NOW()
       WHERE alert_type = ANY($1) AND zone_id IS NULL AND deleted_at IS NULL;`,
      [['vehicle_control_match', 'unknown_vehicle', 'vehicle_unauthorized']],
    );
  }
}
