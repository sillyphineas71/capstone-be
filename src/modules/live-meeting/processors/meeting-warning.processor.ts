import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MeetingWarningService } from '../services/meeting-warning.service.js';

/**
 * MeetingWarningProcessor — BullMQ job processor cho UC-IMM-13.
 *
 * Lang nghe job 'meeting-time-warning' tren queue QUEUE_SCHEDULER_NAME.
 * Delegate toan bo business logic sang MeetingWarningService.
 *
 * Error handling:
 * - MeetingWarningService.processWarningJob() tu handle guard/idempotency/failure
 * - Neu throw exception -> BullMQ tu dong NACK + retry theo attempts config
 * - Neu return skipped -> BullMQ ACK (khong retry)
 * - Job name khong khop -> ACK silently
 */
@Processor('scheduler')
export class MeetingWarningProcessor extends WorkerHost {
  private readonly logger = new Logger(MeetingWarningProcessor.name);

  constructor(private readonly meetingWarningService: MeetingWarningService) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    if (job.name !== 'meeting-time-warning') {
      this.logger.warn(
        '[MeetingWarningProcessor] Unknown job name=' + job.name + ' - ACK',
      );
      return;
    }

    this.logger.log(
      '[MeetingWarningProcessor] Processing job ' +
        job.id +
        ' name=' +
        job.name +
        ' meetingId=' +
        job.data?.meetingId,
    );

    try {
      const result = await this.meetingWarningService.processWarningJob(
        job.data,
      );
      this.logger.log(
        '[MeetingWarningProcessor] Job ' +
          job.id +
          ' completed - skipped=' +
          result.skipped +
          ' branch=' +
          (result.branch || 'N/A') +
          ' warningLevel=' +
          (result.warningLevel || 'N/A'),
      );
      return result;
    } catch (error: unknown) {
      this.logger.error(
        '[MeetingWarningProcessor] Job ' +
          job.id +
          ' failed - error=' +
          (error as Error).message +
          ' meetingId=' +
          job.data?.meetingId,
      );
      throw error; // NACK -> BullMQ retry
    }
  }
}
