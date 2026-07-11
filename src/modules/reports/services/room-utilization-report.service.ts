import {
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { DashboardOverviewConfigService } from '../../analytics/services/dashboard-overview-config.service.js';
import { CreateRoomUtilizationExportDto } from '../dto/create-room-utilization-export.dto.js';
import { CreateRoomUtilizationExportResponseDto } from '../dto/room-utilization-export-response.dto.js';
import { RoomUtilizationReportDataService } from './room-utilization-report-data.service.js';
import {
  REPORT_EXPORT_QUEUE_NAME,
  ROOM_UTILIZATION_EXPORT_JOB_NAME,
} from '../constants/report-export-job.constants.js';

/**
 * RoomUtilizationReportService — orchestrator cho UC-RUM-16.
 *
 * Khác UC-AA-12: KHÔNG có logic scope theo phòng ban Manager (permission
 * `report.room_utilization.export` chỉ seed cho BUSINESS_ADMIN/SYSTEM_ADMIN —
 * §0.5 spec.md), chỉ lọc theo `scope.roomId` tùy chọn.
 *
 * FR-004..FR-007: validate → empty-data check (FR-017, đồng bộ trước khi tạo
 * job) → createQueuedJob → enqueue BullMQ → trả jobId.
 */
@Injectable()
export class RoomUtilizationReportService {
  private readonly logger = new Logger(RoomUtilizationReportService.name);

  constructor(
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly queueService: QueueService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dataService: RoomUtilizationReportDataService,
    private readonly configService: ConfigService,
  ) {}

  async createExportJob(
    currentUser: { userId: string; email: string },
    dto: CreateRoomUtilizationExportDto,
  ): Promise<CreateRoomUtilizationExportResponseDto> {
    this.validateDateRange(dto.from, dto.to);
    await this.validateMaxRangeDays(dto.from, dto.to);
    this.validateDelivery(dto.delivery);

    const scope = { roomId: dto.scope?.roomId ?? null };

    // FR-017: empty-data check dong bo truoc khi tao job (khong tao job rong)
    const hasData = await this.dataService.hasAnyBookingInScope({
      from: dto.from,
      to: dto.to,
      scope,
    });
    if (!hasData) {
      throw new UnprocessableEntityException({
        success: false,
        message:
          'Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo.',
        error: { code: 'EMPTY_DATA_SET', details: {} },
      });
    }

    const backgroundJob = await this.backgroundJobsService.createQueuedJob({
      jobType: BackgroundJobType.EXPORT_REPORT,
      requestedBy: currentUser.userId,
      relatedEntityType: 'room_utilization_report',
      inputJson: {
        from: dto.from,
        to: dto.to,
        format: dto.format,
        scope,
        delivery: 'download',
      },
    });

    await this.queueService.addJob(
      REPORT_EXPORT_QUEUE_NAME,
      ROOM_UTILIZATION_EXPORT_JOB_NAME,
      {
        backgroundJobId: backgroundJob.id,
        from: dto.from,
        to: dto.to,
        format: dto.format,
        scope,
        requestedByEmail: currentUser.email,
      },
    );

    this.writeAuditLog(
      currentUser.userId,
      backgroundJob.id,
      dto.from,
      dto.to,
      dto.format,
      scope,
    ).catch((err) =>
      this.logger.warn(
        `Audit log write failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );

    return {
      jobId: backgroundJob.id,
      status: 'queued',
      delivery: 'download',
      outputFileId: null,
    };
  }

  private validateDateRange(from: string, to: string): void {
    if (!from || !to) {
      throw new BadRequestException({
        success: false,
        message: 'from và to là bắt buộc.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (from > to) {
      throw new BadRequestException({
        success: false,
        message: 'from không được sau to.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  private async validateMaxRangeDays(from: string, to: string): Promise<void> {
    const maxDays = await this.dashboardConfigService.getMaxRangeDays();
    const diffDays =
      (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    if (diffDays > maxDays) {
      throw new BadRequestException({
        success: false,
        message: `Kỳ báo cáo vượt quá ${maxDays} ngày tối đa.`,
        error: { code: 'DATE_RANGE_TOO_LARGE', details: { maxDays } },
      });
    }
  }

  private validateDelivery(delivery: string | undefined): void {
    if (delivery !== undefined && delivery !== 'download') {
      throw new BadRequestException({
        success: false,
        message: "Chỉ hỗ trợ delivery='download'.",
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
  }

  private async writeAuditLog(
    userId: string,
    jobId: string,
    from: string,
    to: string,
    format: string,
    scope: { roomId: string | null },
  ): Promise<void> {
    const auditEnabled = this.configService.get<string>(
      'AUDIT_LOG_ENABLED',
      'true',
    );
    if (auditEnabled !== 'true') return;
    await this.auditLogsService.logAction({
      userId,
      actionType: 'export_room_utilization_report',
      entityType: 'background_jobs',
      entityId: jobId,
      metadataJson: { viewerUserId: userId, from, to, format, scope, jobId },
    });
  }
}
