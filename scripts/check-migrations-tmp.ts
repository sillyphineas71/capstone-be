import { AppDataSource } from '../src/database/data-source.js';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const rows = await AppDataSource.query(
    `SELECT name, timestamp FROM typeorm_migrations WHERE name ILIKE '%alert%' OR name ILIKE '%controllist%' OR name ILIKE '%personcontrol%' OR name ILIKE '%campusdashboard%' OR name ILIKE '%gateaccess%' OR name ILIKE '%vehiclecontrol%' OR name ILIKE '%report%' ORDER BY timestamp`,
  );
  console.log('Matching migration rows:', rows);
  await AppDataSource.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
