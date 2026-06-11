import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuditLogEntity, AuditLogSeverity } from '../entities/audit-log.entity.js';

export interface LogActionDto {
  userId?: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  severity?: AuditLogSeverity;
  metadataJson?: Record<string, unknown>;
}

export interface LogEntityChangeDto {
  userId?: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  oldValueJson?: Record<string, unknown>;
  newValueJson?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  severity?: AuditLogSeverity;
}

export interface LogSecurityEventDto {
  userId?: string;
  actionType: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  severity?: AuditLogSeverity;
  metadataJson?: Record<string, unknown>;
}

/**
 * AuditLogsService — Service ghi audit log dùng chung.
 *
 * Entity AuditLogEntity đã có sẵn trong DB v3.2 (bảng audit_logs).
 *
 * Tôn trọng:
 * - AUDIT_LOG_ENABLED: nếu false thì skip tất cả log
 * - AUDIT_LOG_FAIL_SAFE: nếu true, lỗi ghi log không throw ra business flow
 *
 * TUYỆT ĐỐI KHÔNG log: password, token, OTP, secret, credentials.
 *
 * Auth module có thể tiếp tục dùng raw SQL cho security-sensitive entries
 * (xem AdministrationModule comment), service này phục vụ business modules.
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);
  private readonly enabled: boolean;
  private readonly failSafe: boolean;

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('AUDIT_LOG_ENABLED', true);
    this.failSafe = this.configService.get<boolean>('AUDIT_LOG_FAIL_SAFE', true);
  }

  /**
   * Log hành động chung (CRUD, view, export,...).
   */
  async logAction(dto: LogActionDto): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      userId: dto.userId ?? null,
      actionType: dto.actionType,
      entityType: dto.entityType,
      entityId: dto.entityId ?? null,
      oldValueJson: null,
      newValueJson: null,
      ipAddress: dto.ipAddress ?? null,
      userAgent: dto.userAgent ?? null,
      requestId: dto.requestId ?? null,
      severity: dto.severity ?? AuditLogSeverity.INFO,
      metadataJson: dto.metadataJson ?? null,
    });
  }

  /**
   * Log security event (login, logout, OTP request, password change,...).
   * Không bao giờ log giá trị password/token/OTP thật.
   */
  async logSecurityEvent(dto: LogSecurityEventDto): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      userId: dto.userId ?? null,
      actionType: dto.actionType,
      entityType: dto.entityType ?? 'auth',
      entityId: dto.entityId ?? null,
      oldValueJson: null,
      newValueJson: null,
      ipAddress: dto.ipAddress ?? null,
      userAgent: dto.userAgent ?? null,
      requestId: dto.requestId ?? null,
      severity: dto.severity ?? AuditLogSeverity.WARNING,
      metadataJson: dto.metadataJson ?? null,
    });
  }

  /**
   * Log thay đổi entity với before/after JSON.
   * Caller có trách nhiệm sanitize old/newValueJson trước khi truyền vào.
   * Không truyền password, token, secret vào old/newValueJson.
   */
  async logEntityChange(dto: LogEntityChangeDto): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      userId: dto.userId ?? null,
      actionType: dto.actionType,
      entityType: dto.entityType,
      entityId: dto.entityId ?? null,
      oldValueJson: dto.oldValueJson ?? null,
      newValueJson: dto.newValueJson ?? null,
      ipAddress: dto.ipAddress ?? null,
      userAgent: dto.userAgent ?? null,
      requestId: dto.requestId ?? null,
      severity: dto.severity ?? AuditLogSeverity.INFO,
      metadataJson: null,
    });
  }

  /**
   * Internal write — xử lý fail-safe.
   */
  private async write(data: Partial<AuditLogEntity>): Promise<void> {
    try {
      const entry = this.repo.create(data);
      await this.repo.save(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (this.failSafe) {
        // Log lỗi nhưng không throw — không làm fail business flow
        this.logger.error(`[AuditLogs] Failed to write audit log (fail-safe mode): ${message}`);
      } else {
        throw error;
      }
    }
  }
}
