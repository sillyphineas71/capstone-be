import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { ConfigService } from '@nestjs/config';

export interface AddJobOptions extends Partial<JobsOptions> {
  /** Override số lần retry (mặc định lấy từ BULL_DEFAULT_ATTEMPTS) */
  attempts?: number;
  /** Override delay backoff ms (mặc định lấy từ BULL_DEFAULT_BACKOFF_DELAY_MS) */
  backoffDelay?: number;
}

/**
 * QueueService — Helper service để add job vào BullMQ queues.
 *
 * Inject service này vào bất kỳ module nào cần enqueue job.
 * Không implement worker/processor logic ở đây.
 *
 * Tên queue maps:
 * - 'auth'            → QUEUE_AUTH
 * - 'notification'    → QUEUE_NOTIFICATION
 * - 'account-import'  → QUEUE_ACCOUNT_IMPORT
 * - 'media-processing'→ QUEUE_MEDIA_PROCESSING
 * - 'transcription'   → QUEUE_TRANSCRIPTION
 * - 'report-export'   → QUEUE_REPORT_EXPORT
 * - 'minutes-export'  → QUEUE_MINUTES_EXPORT
 * - 'scheduler'       → QUEUE_SCHEDULER
 * - 'minutes.generate_ai_draft' → QUEUE_MINUTES_AI_DRAFT (MKM-AI-01)
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly defaultAttempts: number;
  private readonly defaultBackoffDelay: number;

  private readonly queueMap: Map<string, Queue>;

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('QUEUE_AUTH_NAME') private readonly authQueue: Queue,
    @InjectQueue('QUEUE_NOTIFICATION_NAME')
    private readonly notificationQueue: Queue,
    @InjectQueue('QUEUE_ACCOUNT_IMPORT_NAME')
    private readonly accountImportQueue: Queue,
    @InjectQueue('QUEUE_MEDIA_PROCESSING_NAME')
    private readonly mediaProcessingQueue: Queue,
    @InjectQueue('QUEUE_TRANSCRIPTION_NAME')
    private readonly transcriptionQueue: Queue,
    @InjectQueue('QUEUE_REPORT_EXPORT_NAME')
    private readonly reportExportQueue: Queue,
    @InjectQueue('QUEUE_MINUTES_EXPORT_NAME')
    private readonly minutesExportQueue: Queue,
    @InjectQueue('QUEUE_SCHEDULER_NAME') private readonly schedulerQueue: Queue,
    @InjectQueue('QUEUE_MINUTES_AI_DRAFT_NAME')
    private readonly minutesAiDraftQueue: Queue,
  ) {
    this.defaultAttempts = this.configService.get<number>(
      'BULL_DEFAULT_ATTEMPTS',
      3,
    );
    this.defaultBackoffDelay = this.configService.get<number>(
      'BULL_DEFAULT_BACKOFF_DELAY_MS',
      5000,
    );

    // Build map từ env queue name → Queue instance
    this.queueMap = new Map<string, Queue>([
      [this.configService.get<string>('QUEUE_AUTH', 'auth'), this.authQueue],
      [
        this.configService.get<string>('QUEUE_NOTIFICATION', 'notification'),
        this.notificationQueue,
      ],
      [
        this.configService.get<string>(
          'QUEUE_ACCOUNT_IMPORT',
          'account-import',
        ),
        this.accountImportQueue,
      ],
      [
        this.configService.get<string>(
          'QUEUE_MEDIA_PROCESSING',
          'media-processing',
        ),
        this.mediaProcessingQueue,
      ],
      [
        this.configService.get<string>('QUEUE_TRANSCRIPTION', 'transcription'),
        this.transcriptionQueue,
      ],
      [
        this.configService.get<string>('QUEUE_REPORT_EXPORT', 'report-export'),
        this.reportExportQueue,
      ],
      [
        this.configService.get<string>(
          'QUEUE_MINUTES_EXPORT',
          'minutes-export',
        ),
        this.minutesExportQueue,
      ],
      [
        this.configService.get<string>('QUEUE_SCHEDULER', 'scheduler'),
        this.schedulerQueue,
      ],
      [
        this.configService.get<string>(
          'QUEUE_MINUTES_AI_DRAFT',
          'minutes.generate_ai_draft',
        ),
        this.minutesAiDraftQueue,
      ],
    ]);
  }

  /**
   * Add job vào queue theo tên.
   *
   * @param queueName - tên queue (giá trị của QUEUE_* env, VD: 'notification')
   * @param jobName   - tên job (VD: 'send-email', 'process-media')
   * @param data      - payload của job
   * @param options   - override options (attempts, delay, ...)
   */
  async addJob<T = Record<string, unknown>>(
    queueName: string,
    jobName: string,
    data: T,
    options?: AddJobOptions,
  ): Promise<string | undefined> {
    const queue = this.queueMap.get(queueName);
    if (!queue) {
      this.logger.error(
        `QueueService.addJob: queue "${queueName}" not found. Available: ${Array.from(this.queueMap.keys()).join(', ')}`,
      );
      throw new Error(`Queue "${queueName}" is not registered.`);
    }

    const jobOptions: JobsOptions = {
      attempts: options?.attempts ?? this.defaultAttempts,
      backoff: {
        type: 'exponential',
        delay: options?.backoffDelay ?? this.defaultBackoffDelay,
      },
      ...options,
    };

    const job = await queue.add(jobName, data, jobOptions);
    this.logger.debug(
      `[QueueService] Enqueued job "${jobName}" on queue "${queueName}" — jobId: ${job.id}`,
    );
    return job.id;
  }

  /**
   * Lấy Queue instance theo tên (cho trường hợp cần thao tác nâng cao).
   */
  getQueue(queueName: string): Queue | undefined {
    return this.queueMap.get(queueName);
  }
}
