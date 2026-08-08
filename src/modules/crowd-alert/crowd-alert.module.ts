import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { ZonePresenceEventEntity } from '../zones/entities/zone-presence-event.entity.js';
import { CrowdAlertService } from './services/crowd-alert.service.js';
import { ivssBridgeProvider } from '../ivss/ivss-bridge.factory.js';

/**
 * CrowdAlertModule (ACR-001 / UC-121 — Bước 4 SAVP: cảnh báo tụ tập đông người).
 *
 * Mirror `RestrictedZoneModule` (Bước 3f/UC-124): cron-only, KHÔNG endpoint HTTP.
 * Tự `forFeature` lại `ZonePresenceEventEntity` (KHÔNG import `ZonesModule`) — tránh kéo
 * theo provider/controller không cần, tránh rủi ro vòng phụ thuộc.
 *
 * `ivssBridgeProvider` (2026-08-09, snapshot chủ động khi crowd-alert vượt ngưỡng):
 * đăng ký LẠI provider này ở đây (KHÔNG import `IvssModule`) — `IvssModule` đã import
 * `CrowdAlertModule` (lấy `evaluateZoneCountNow()` cho đường tức thời); import ngược lại
 * `IvssModule` sẽ tạo circular dependency (`IvssModule → CrowdAlertModule → IvssModule`).
 * `ivssBridgeProvider` là factory độc lập (không thuộc riêng `IvssModule`) — đăng ký lại
 * tạo 1 instance `IvssBridgeClient` riêng cho module này, NHƯNG cùng class/cùng 3 env var
 * (`IVSS_BRIDGE_BASE_URL`/`IVSS_BRIDGE_TOKEN`/`IVSS_BRIDGE_TIMEOUT_MS`) — không phải client
 * HTTP mới, không lệch cấu hình. `StorageService` KHÔNG cần import — `StorageModule`
 * `@Global()`.
 */
@Module({
  imports: [AlertsModule, TypeOrmModule.forFeature([ZonePresenceEventEntity])],
  providers: [CrowdAlertService, ivssBridgeProvider],
  exports: [CrowdAlertService],
})
export class CrowdAlertModule {}
