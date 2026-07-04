import { AppDataSource } from '../src/database/data-source.js';

/**
 * Standalone migration runner executed via `tsx`.
 *
 * `npm run migration:run` (typeorm-ts-node-commonjs) fails on this project because
 * tsconfig uses `module`/`moduleResolution: nodenext`, which requires explicit `.js`
 * extensions on relative imports (e.g. `from './user.entity.js'`) — ts-node's
 * CommonJS CLI mode does not resolve those back to the sibling `.ts` files. `tsx`
 * handles NodeNext-style resolution correctly, so this script does the same job
 * (`AppDataSource.runMigrations()`) without depending on the broken CLI path.
 */
async function main(): Promise<void> {
  // Some migrations (e.g. `ALTER TYPE ... ADD VALUE`) cannot run inside a
  // transaction and declare `transaction = false`. That only takes effect
  // when the DataSource-wide mode is 'each' instead of the default 'all'.
  AppDataSource.setOptions({ migrationsTransactionMode: 'each' });
  await AppDataSource.initialize();
  const applied = await AppDataSource.runMigrations();
  console.log(`Applied ${applied.length} migration(s):`);
  for (const m of applied) {
    console.log(' -', m.name);
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
