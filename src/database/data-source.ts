import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * TypeORM DataSource configuration for CLI usage (migration:generate, migration:run, migration:revert).
 *
 * Usage:
 *   npx typeorm-ts-node-commonjs migration:generate src/database/migrations/MigrationName -d src/database/data-source.ts
 *   npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
 *   npx typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts
 *
 * NOTE: This DataSource is ONLY for CLI. The runtime DataSource is managed by DatabaseModule (TypeOrmModule.forRootAsync).
 * NOTE: synchronize is ALWAYS false — never enable in production.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'postgres',
  ssl:
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: [path.join(__dirname, '../modules/**/*.entity.{ts,js}')],
  migrations: [path.join(__dirname, './migrations/*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',

});
