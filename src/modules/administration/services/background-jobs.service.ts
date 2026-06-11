import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
  BackgroundJobType,
} from '../entities/background-job.entity.js';

export interface CreateQueuedJobDto {
  jobType: BackgroundJobType;
  queueName?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  requestedBy?: string;
  priority?: number;
  scheduledAt?: Date;
  inputJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

/**
 * BackgroundJobsService — Service dùng chung để track background jobs trong DB.
 *
 * Entity BackgroundJobEntity đã có sẵn trong DB v3.2 (bảng background_jobs).
 * Service này chỉ cung cấp CRUD lifecycle methods — không implement business logic.
 *
 * Luồng điển hình:
 * 1. createQueuedJob()  — khi enqueue
 * 2. markRunning()      — khi worker bắt đầu
 * 3. markCompleted() hoặc markFailed() — khi worker xong
 */
@Injectable()
export class BackgroundJobsService {
  private readonly logger = new Logger(BackgroundJobsService.name);

  constructor(
    @InjectRepository(BackgroundJobEntity)
    private readonly repo: Repository<BackgroundJobEntity>,
  ) {}

  /**
   * Tạo background job record với status=queued.
   */
  async createQueuedJob(dto: CreateQueuedJobDto): Promise<BackgroundJobEntity> {
    const job = this.repo.create({
      jobType: dto.jobType,
      queueName: dto.queueName ?? null,
      relatedEntityType: dto.relatedEntityType ?? null,
      relatedEntityId: dto.relatedEntityId ?? null,
      requestedBy: dto.requestedBy ?? null,
      priority: dto.priority ?? 0,
      scheduledAt: dto.scheduledAt ?? null,
      inputJson: dto.inputJson ?? null,
      metadataJson: dto.metadataJson ?? null,
      status: BackgroundJobStatus.QUEUED,
      retryCount: 0,
    });
    const saved = await this.repo.save(job);
    this.logger.debug(`[BackgroundJobs] Created job ${saved.id} — type: ${saved.jobType}`);
    return saved;
  }

  /**
   * Đánh dấu job đang chạy.
   */
  async markRunning(id: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.RUNNING,
      startedAt: new Date(),
    });
  }

  /**
   * Đánh dấu job hoàn thành.
   */
  async markCompleted(id: string, outputJson?: Record<string, unknown>): Promise<void> {
    const updatePayload: Partial<BackgroundJobEntity> = {
      status: BackgroundJobStatus.COMPLETED,
      completedAt: new Date(),
      errorMessage: null,
    };
    if (outputJson !== undefined) {
      updatePayload.outputJson = outputJson;
    }
    await this.repo.update(id, updatePayload as Parameters<typeof this.repo.update>[1]);
  }

  /**
   * Đánh dấu job thất bại.
   */
  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.FAILED,
      completedAt: new Date(),
      errorMessage,
    });
    this.logger.warn(`[BackgroundJobs] Job ${id} failed: ${errorMessage}`);
  }

  /**
   * Đánh dấu job đang retry — tăng retry_count.
   */
  async markRetrying(id: string): Promise<void> {
    await this.repo.increment({ id }, 'retryCount', 1);
    await this.repo.update(id, { status: BackgroundJobStatus.RETRYING });
  }

  /**
   * Hủy job.
   */
  async cancelJob(id: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.CANCELLED,
      completedAt: new Date(),
    });
  }

  /**
   * Tìm job theo ID. Throw NotFoundException nếu không tìm thấy.
   */
  async findById(id: string): Promise<BackgroundJobEntity> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`BackgroundJob with id "${id}" not found.`);
    }
    return job;
  }

  /**
   * Tìm job theo ID (nullable — không throw).
   */
  async findByIdOrNull(id: string): Promise<BackgroundJobEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
