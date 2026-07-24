import { AppDataSource } from '../src/database/data-source.js';

import { seedUserUpdateRolesPermission } from '../src/database/seeds/20260712000001-SeedUserUpdateRolesPermission.js';
import { seedUserUpdatePermission } from '../src/database/seeds/20260712000002-SeedUserUpdatePermission.js';
import { seedUserDeletePermission } from '../src/database/seeds/20260712000003-SeedUserDeletePermission.js';
import { seedUserUpdateStatusPermission } from '../src/database/seeds/20260712000004-SeedUserUpdateStatusPermission.js';
import { seedUserLockPermissions } from '../src/database/seeds/20260712000005-SeedUserLockPermissions.js';
import { seedUserManagePermission } from '../src/database/seeds/20260713000001-SeedUserManagePermission.js';

/**
 * Standalone seed runner for the Account Management UCs (UC-08 → UC-14).
 * Chạy bằng `tsx` (giống scripts/run-migrations.ts) vì tsconfig dùng NodeNext.
 *
 * Mỗi hàm seed đã idempotent (ON CONFLICT DO NOTHING) nên chạy lại nhiều lần an toàn.
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();

  const seeds: Array<[string, (ds: typeof AppDataSource) => Promise<void>]> = [
    ['UC-08 accounts.user.update_roles', seedUserUpdateRolesPermission],
    ['UC-09 accounts.user.update', seedUserUpdatePermission],
    ['UC-10 accounts.user.delete', seedUserDeletePermission],
    ['UC-11 accounts.user.update_status', seedUserUpdateStatusPermission],
    ['UC-12 accounts.user.lock + unlock', seedUserLockPermissions],
    ['UC-14 accounts.user.manage', seedUserManagePermission],
  ];

  for (const [label, fn] of seeds) {
    process.stdout.write(`Seeding ${label} ... `);
    await fn(AppDataSource);
    console.log('done');
  }

  await AppDataSource.destroy();
  console.log('\nAll account permission seeds applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
