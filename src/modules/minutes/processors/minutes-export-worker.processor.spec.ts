import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { MinutesExportWorkerProcessor } from './minutes-export-worker.processor.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { MINUTES_EXPORT_JOB_NAME } from '../constants/minutes-export-job.constants.js';

describe('MinutesExportWorkerProcessor', () => {
  const minutesId = 'minutes-1';
  const meetingId = 'meeting-1';

  let minutesRow: Partial<MeetingMinutesEntity> | null;
  let transcriptRow: Partial<TranscriptEntity> | null;
  let markRunning: jest.Mock;
  let markCompleted: jest.Mock;
  let markFailed: jest.Mock;
  let logAction: jest.Mock;
  let managerUpdate: jest.Mock;
  let mediaSave: jest.Mock;
  let getDriver: jest.Mock;
  let processor: MinutesExportWorkerProcessor;

  const makeJob = (data: Partial<any> = {}): Job<any> =>
    ({
      name: MINUTES_EXPORT_JOB_NAME,
      data: {
        backgroundJobId: 'job-1',
        minutesId,
        format: 'pdf',
        includeTranscript: false,
        includeActionItems: true,
        requestedByUserId: 'user-1',
        ...data,
      },
    }) as unknown as Job<any>;

  beforeEach(() => {
    minutesRow = {
      id: minutesId,
      meetingId,
      title: 'Bien ban',
      status: MeetingMinutesStatus.PUBLISHED,
      minutesContent: 'Noi dung',
      decisionsJson: null,
      actionItemsJson: null,
      linkedTranscriptId: null,
      issuedAt: new Date('2026-07-17T00:00:00Z'),
      deletedAt: null,
    };
    transcriptRow = {
      id: 't-1',
      cleanedText: 'transcript text',
      rawText: null,
    };

    markRunning = jest.fn().mockResolvedValue(undefined);
    markCompleted = jest.fn().mockResolvedValue(undefined);
    markFailed = jest.fn().mockResolvedValue(undefined);
    logAction = jest.fn().mockResolvedValue(undefined);
    managerUpdate = jest.fn().mockResolvedValue(undefined);
    mediaSave = jest
      .fn()
      .mockImplementation((e: any) => Promise.resolve({ ...e, id: 'media-1' }));
    getDriver = jest.fn().mockReturnValue('local');

    const dataSource = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === MeetingMinutesEntity) {
          return {
            findOne: jest
              .fn()
              .mockImplementation(() => Promise.resolve(minutesRow)),
          };
        }
        if (entity === MeetingEntity) {
          return {
            findOne: jest.fn().mockResolvedValue({ id: meetingId, title: 'M' }),
          };
        }
        if (entity === TranscriptEntity) {
          return {
            findOne: jest
              .fn()
              .mockImplementation(() => Promise.resolve(transcriptRow)),
          };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      }),
    } as unknown as DataSource;

    const backgroundJobsService = {
      markRunning,
      markCompleted,
      markFailed,
    } as unknown as BackgroundJobsService;

    const auditLogsService = { logAction } as unknown as AuditLogsService;

    const mediaFileRepo = {
      create: jest.fn().mockImplementation((d: any) => ({ ...d })),
      save: mediaSave,
      manager: { update: managerUpdate },
    } as unknown as Repository<MediaFileEntity>;

    const storageService = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'exports/minutes-1.pdf',
        publicUrl: 'http://x/minutes-1.pdf',
        sizeBytes: 1234,
      }),
      getDriver,
    } as unknown as StorageService;

    processor = new MinutesExportWorkerProcessor(
      dataSource,
      backgroundJobsService,
      auditLogsService,
      mediaFileRepo,
      storageService,
    );
  });

  it('renders PDF, saves media (type EXPORT), completes job + audit', async () => {
    await processor.process(makeJob());
    expect(markRunning).toHaveBeenCalledWith('job-1');
    expect(mediaSave).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: MediaFileType.EXPORT,
        relatedEntityType: 'meeting_minutes',
        relatedEntityId: minutesId,
      }),
    );
    expect(markCompleted).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ outputFileId: 'media-1', format: 'pdf' }),
    );
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'meeting_minutes_exported' }),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('default export (pdf + both includes) updates meeting_minutes.file_id', async () => {
    await processor.process(
      makeJob({ includeTranscript: true, includeActionItems: true }),
    );
    expect(managerUpdate).toHaveBeenCalledWith(
      MeetingMinutesEntity,
      minutesId,
      { fileId: 'media-1' },
    );
  });

  it('non-default export (docx) does NOT update file_id', async () => {
    await processor.process(makeJob({ format: 'docx' }));
    // managerUpdate called once for background job output_file_id, but NOT for MeetingMinutesEntity
    const minutesUpdateCalls = managerUpdate.mock.calls.filter(
      (c) => c[0] === MeetingMinutesEntity,
    );
    expect(minutesUpdateCalls).toHaveLength(0);
  });

  it('includeTranscript=true but no linkedTranscriptId still completes', async () => {
    minutesRow!.linkedTranscriptId = null;
    await processor.process(makeJob({ includeTranscript: true }));
    expect(markCompleted).toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('render/storage error → markFailed, does NOT throw', async () => {
    minutesRow = null; // triggers "khong ton tai" error inside try
    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(markFailed).toHaveBeenCalledWith('job-1', expect.any(String));
    expect(markCompleted).not.toHaveBeenCalled();
  });

  it('ignores jobs with a different name', async () => {
    const job = makeJob();
    (job as any).name = 'some:other-job';
    await processor.process(job);
    expect(markRunning).not.toHaveBeenCalled();
  });
});
