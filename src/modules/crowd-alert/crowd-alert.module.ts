import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { ZonePresenceEventEntity } from '../zones/entities/zone-presence-event.entity.js';
import { CrowdAlertService } from './services/crowd-alert.service.js';

/**
 * CrowdAlertModule (ACR-001 / UC-121 — Bước 4 SAVP: cảnh báo tụ tập đông người).
 *
 * Mirror `RestrictedZoneModule` (Bước 3f/UC-124): cron-only, KHÔNG endpoint HTTP.
 * Tự `forFeature` lại `ZonePresenceEventEntity` (KHÔNG import `ZonesModule`) — tránh kéo
 * theo provider/controller không cần, tránh rủi ro vòng phụ thuộc.
 */
@Module({
  imports: [AlertsModule, TypeOrmModule.forFeature([ZonePresenceEventEntity])],
  providers: [CrowdAlertService],
  exports: [CrowdAlertService],
})
export class CrowdAlertModule {}
