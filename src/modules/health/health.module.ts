import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller.js';
import { RedisModule } from '../redis/redis.module.js';
import { StorageModule } from '../storage/storage.module.js';

/**
 * HealthModule — Cung cấp endpoint GET /health (public).
 *
 * Checks:
 * - DB (TypeORM connection)
 * - Redis (ioredis ping)
 * - BullMQ Redis (ping DB=1)
 * - Local storage path (nếu STORAGE_DRIVER=local)
 *
 * Không check MinIO nếu STORAGE_DRIVER=local.
 * Không trả về secret hoặc config chi tiết trong response.
 */
@Module({
  imports: [TerminusModule, ConfigModule, TypeOrmModule, RedisModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}

