/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  MinutesAiDraftService,
  AiDraftAuthUser,
} from './minutes-ai-draft.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import {
  TranscriptEntity,
  TranscriptSecurityStatus,
  TranscriptStatus,
} from '../../transcription/entities/transcript.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
  BackgroundJobType,
} from '../../administration/entities/background-job.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { CreateAiDraftJobDto } from '../dto/create-ai-draft-job.dto.js';
import {
  AI_MINUTES_ERROR_CODES,
  AI_MINUTES_JOB_ATTEMPTS,
  AI_MINUTES_JOB_NAME,
  AI_MINUTES_QUEUE_NAME,
} from '../constants/ai-minutes-draft.constants.js';

const MEETING_ID = '11111111-1111-1111-1111-111111111111';
const TRANSCRIPT_ID = '22222222-2222-2222-2222-222222222222';
const HOST_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_USER_ID = '44444444-4444-4444-4444-444444444444';
const JOB_ID = '55555555-5555-5555-5555-555555555555';
const MINUTES_ID = '66666666-6666-6666-6666-666666666666';

type ErrorPayload = {
  error: { code: string; details?: Record<string, unknown> };
};

function errorCode(err: unknown): string {
  const payload = (err as { getResponse: () => ErrorPayload }).getResponse();
  return payload.error.code;
}

describe('MinutesAiDraftService', () => {
  let service: MinutesAiDraftService;
  let dataSource: {
    transaction: jest.Mock;
    getRepository: jest.Mock;
  };
  let queueService: { addJob: jest.Mock };

  let meetingQueryBuilder: {
    setLock: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };
  let meetingRepo: { createQueryBuilder: jest.Mock };
  let transcriptRepo: { findOne: jest.Mock };
  let bgJobRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let configRepo: { findOne: jest.Mock };
  let minutesRepo: { findOne: jest.Mock };
  let compensatingJobRepo: { update: jest.Mock };
  let em: { getRepository: jest.Mock; query: jest.Mock };

  const validMeeting = (): Partial<MeetingEntity> => ({
    id: MEETING_ID,
    hostId: HOST_ID,
    deletedAt: null,
  });

  const validTranscript = (): Partial<TranscriptEntity> => ({
    id: TRANSCRIPT_ID,
    meetingId: MEETING_ID,
    status: TranscriptStatus.DRAFT,
    securityStatus: TranscriptSecurityStatus.PENDING_SCAN,
  });

  const enabledConfig = (): Partial<SystemConfigEntity> => ({
    configKey: 'ai.minutes_summary',
    isActive: true,
    configJson: {
      enabled: true,
      provider: 'mock',
      modelName: 'qwen2.5:7b-instruct',
      maxInputTokens: 6000,
    },
  });

  const savedJob = (): Partial<BackgroundJobEntity> => ({
    id: JOB_ID,
    jobType: BackgroundJobType.AI_MEETING_SUMMARY,
    status: BackgroundJobStatus.QUEUED,
  });

  const dto = (overrides: Partial<CreateAiDraftJobDto> = {}) => ({
    transcriptId: TRANSCRIPT_ID,
    ...overrides,
  });

  const hostUser: AiDraftAuthUser = { userId: HOST_ID };

  beforeEach(() => {
    meetingQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(validMeeting()),
    };
    meetingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(meetingQueryBuilder),
    };
    transcriptRepo = {
      findOne: jest.fn().mockResolvedValue(validTranscript()),
    };
    bgJobRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(savedJob()),
    };
    configRepo = { findOne: jest.fn().mockResolvedValue(enabledConfig()) };
    minutesRepo = { findOne: jest.fn().mockResolvedValue(null) };
    compensatingJobRepo = { update: jest.fn().mockResolvedValue(undefined) };

    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === TranscriptEntity) return transcriptRepo;
        if (entity === BackgroundJobEntity) return bgJobRepo;
        if (entity === SystemConfigEntity) return configRepo;
        if (entity === MeetingMinutesEntity) return minutesRepo;
        throw new Error('Unexpected entity in test');
      }),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof em) => unknown) => cb(em)),
      getRepository: jest.fn().mockReturnValue(compensatingJobRepo),
    };
    queueService = { addJob: jest.fn().mockResolvedValue('bull-job-id') };

    service = new MinutesAiDraftService(
      dataSource as never,
      queueService as unknown as QueueService,
    );
  });

  // ── Happy path (AC-001 phần API) ──────────────────────────────────────────

  it('tao job thanh cong: tra 202 shape, insert bg job dung field, enqueue attempts=2', async () => {
    const result = await service.createAiDraftJob(MEETING_ID, dto(), hostUser);

    expect(result).toEqual({
      jobId: JOB_ID,
      meetingId: MEETING_ID,
      status: 'queued',
    });

    expect(bgJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: BackgroundJobType.AI_MEETING_SUMMARY,
        queueName: AI_MINUTES_QUEUE_NAME,
        relatedEntityType: 'meeting',
        relatedEntityId: MEETING_ID,
        requestedBy: HOST_ID,
        status: BackgroundJobStatus.QUEUED,
        inputJson: {
          transcriptId: TRANSCRIPT_ID,
          language: 'vi-VN',
          forceRerun: false,
        },
      }),
    );

    expect(queueService.addJob).toHaveBeenCalledWith(
      AI_MINUTES_QUEUE_NAME,
      AI_MINUTES_JOB_NAME,
      expect.objectContaining({
        backgroundJobId: JOB_ID,
        meetingId: MEETING_ID,
        transcriptId: TRANSCRIPT_ID,
        language: 'vi-VN',
        forceRerun: false,
        userId: HOST_ID,
      }),
      { attempts: AI_MINUTES_JOB_ATTEMPTS },
    );
  });

  // ── Meeting (ERR-005) ─────────────────────────────────────────────────────

  it('meeting khong ton tai -> 404 MEETING_NOT_FOUND', async () => {
    meetingQueryBuilder.getOne.mockResolvedValue(null);
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND);
  });

  it('meeting da xoa mem -> 404 MEETING_NOT_FOUND', async () => {
    meetingQueryBuilder.getOne.mockResolvedValue({
      ...validMeeting(),
      deletedAt: new Date(),
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND);
  });

  // ── Ownership (ERR-004 / FR-024) ─────────────────────────────────────────

  it('khong phai Host va khong phai SYSTEM_ADMIN -> 403 PERMISSION_DENIED', async () => {
    em.query.mockResolvedValue([]); // khong co role SYSTEM_ADMIN
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), { userId: OTHER_USER_ID })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.PERMISSION_DENIED);
    expect(bgJobRepo.save).not.toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN bypass ownership NHUNG van bi chan boi feature flag tat', async () => {
    em.query.mockResolvedValue([{ role_code: 'SYSTEM_ADMIN' }]);
    configRepo.findOne.mockResolvedValue(null); // thieu config key
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), { userId: OTHER_USER_ID })
      .catch((e) => e);
    // Qua duoc ownership (khong PERMISSION_DENIED) nhung dung o flag
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.AI_SUMMARY_DISABLED);
  });

  it('SYSTEM_ADMIN di het happy path khi flag bat', async () => {
    em.query.mockResolvedValue([{ role_code: 'SYSTEM_ADMIN' }]);
    const result = await service.createAiDraftJob(MEETING_ID, dto(), {
      userId: OTHER_USER_ID,
    });
    expect(result.status).toBe('queued');
    expect(bgJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: OTHER_USER_ID }),
    );
  });

  // ── Feature flag (ERR-009 / FR-014 fail-safe) ────────────────────────────

  it('config key khong ton tai -> 403 AI_SUMMARY_DISABLED', async () => {
    configRepo.findOne.mockResolvedValue(null);
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.AI_SUMMARY_DISABLED);
  });

  it('config enabled=false -> 403 AI_SUMMARY_DISABLED', async () => {
    configRepo.findOne.mockResolvedValue({
      ...enabledConfig(),
      configJson: { enabled: false, provider: 'mock' },
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.AI_SUMMARY_DISABLED);
  });

  // ── Transcript (ERR-006/007/008) ──────────────────────────────────────────

  it('transcript khong ton tai -> 404 TRANSCRIPT_NOT_FOUND', async () => {
    transcriptRepo.findOne.mockResolvedValue(null);
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_FOUND);
  });

  it('transcript thuoc meeting khac -> 404 TRANSCRIPT_NOT_FOUND', async () => {
    transcriptRepo.findOne.mockResolvedValue({
      ...validTranscript(),
      meetingId: '99999999-9999-9999-9999-999999999999',
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_FOUND);
  });

  it('transcript status=processing -> 422 TRANSCRIPT_NOT_READY (AC-005)', async () => {
    transcriptRepo.findOne.mockResolvedValue({
      ...validTranscript(),
      status: TranscriptStatus.PROCESSING,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.TRANSCRIPT_NOT_READY);
  });

  it('transcript security_status=restricted -> 403 TRANSCRIPT_RESTRICTED (FR-017)', async () => {
    transcriptRepo.findOne.mockResolvedValue({
      ...validTranscript(),
      securityStatus: TranscriptSecurityStatus.RESTRICTED,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.TRANSCRIPT_RESTRICTED);
  });

  // ── Dedup (ERR-013 / FR-011 / AC-008) ────────────────────────────────────

  it('da co job queued/running -> 409 AI_JOB_ALREADY_RUNNING', async () => {
    bgJobRepo.findOne.mockResolvedValue({
      id: 'running-job-id',
      status: BackgroundJobStatus.RUNNING,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.AI_JOB_ALREADY_RUNNING);
    expect(bgJobRepo.save).not.toHaveBeenCalled();
  });

  // ── Minutes conflict (ERR-011/012 / FR-010/016/020 / AC-006) ─────────────

  it('da co minutes active + forceRerun=false -> 409 MINUTES_ALREADY_EXISTS', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: MINUTES_ID,
      aiSummaryJson: { meta: {} },
      status: MeetingMinutesStatus.DRAFT,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.MINUTES_ALREADY_EXISTS);
  });

  it('minutes soan tay (aiSummaryJson NULL) + forceRerun=true -> 409 MINUTES_NOT_AI_DRAFT', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: MINUTES_ID,
      aiSummaryJson: null,
      status: MeetingMinutesStatus.DRAFT,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto({ forceRerun: true }), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.MINUTES_NOT_AI_DRAFT);
  });

  it('minutes AI nhung da published + forceRerun=true -> 409 MINUTES_NOT_AI_DRAFT', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: MINUTES_ID,
      aiSummaryJson: { meta: {} },
      status: MeetingMinutesStatus.PUBLISHED,
    });
    const err = await service
      .createAiDraftJob(MEETING_ID, dto({ forceRerun: true }), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe(AI_MINUTES_ERROR_CODES.MINUTES_NOT_AI_DRAFT);
  });

  it('minutes AI draft + forceRerun=true -> tao job thanh cong (FR-016)', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: MINUTES_ID,
      aiSummaryJson: { meta: {} },
      status: MeetingMinutesStatus.DRAFT,
    });
    const result = await service.createAiDraftJob(
      MEETING_ID,
      dto({ forceRerun: true }),
      hostUser,
    );
    expect(result.status).toBe('queued');
    expect(bgJobRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        inputJson: expect.objectContaining({ forceRerun: true }),
      }),
    );
  });

  // ── Enqueue compensating (plan 9.3) ──────────────────────────────────────

  it('enqueue fail sau commit -> mark job failed + 500 ENQUEUE_FAILED', async () => {
    queueService.addJob.mockRejectedValue(new Error('redis down'));
    const err = await service
      .createAiDraftJob(MEETING_ID, dto(), hostUser)
      .catch((e) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(compensatingJobRepo.update).toHaveBeenCalledWith(
      { id: JOB_ID },
      expect.objectContaining({ status: BackgroundJobStatus.FAILED }),
    );
  });

  // ── FR-025: log khong chua noi dung transcript ───────────────────────────

  it('log khi thanh cong chi chua id, khong co noi dung transcript', async () => {
    const logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: (msg: string) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => undefined);

    transcriptRepo.findOne.mockResolvedValue({
      ...validTranscript(),
      rawText: 'NOI_DUNG_NHAY_CAM_TRANSCRIPT',
      cleanedText: 'NOI_DUNG_NHAY_CAM_TRANSCRIPT',
    });

    await service.createAiDraftJob(MEETING_ID, dto(), hostUser);

    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain('NOI_DUNG_NHAY_CAM');
    }
    expect(logSpy).toHaveBeenCalled();
  });
});

// ── MKM-AI-02: list/latest AI draft job theo meeting (resume poll) ──────────
describe('MinutesAiDraftService.listAiDraftJobs (MKM-AI-02)', () => {
  const buildService = (opts: {
    meeting?: Partial<MeetingEntity> | null;
    jobs?: Array<Partial<BackgroundJobEntity>>;
    adminRows?: Array<{ role_code: string }>;
  }) => {
    const meetingRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          opts.meeting === undefined
            ? { id: MEETING_ID, hostId: HOST_ID, deletedAt: null }
            : opts.meeting,
        ),
    };
    const jobQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(opts.jobs ?? []),
    };
    const bgRepo = { createQueryBuilder: jest.fn().mockReturnValue(jobQb) };
    const query = jest.fn().mockResolvedValue(opts.adminRows ?? []);
    const dataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === BackgroundJobEntity) return bgRepo;
        throw new Error('Unexpected entity in test');
      }),
      query,
    };
    const service = new MinutesAiDraftService(
      dataSource as never,
      { addJob: jest.fn() } as unknown as QueueService,
    );
    return { service, jobQb, query };
  };

  it('AC-007: Host xem duoc, map result.minutesId + sort theo timeline DESC NULLS FIRST', async () => {
    const { service, jobQb } = buildService({
      jobs: [
        {
          id: JOB_ID,
          status: BackgroundJobStatus.RUNNING,
          scheduledAt: null,
          startedAt: new Date('2026-07-13T02:00:00Z'),
          completedAt: null,
          errorMessage: null,
          outputJson: null,
        },
        {
          id: MINUTES_ID,
          status: BackgroundJobStatus.COMPLETED,
          scheduledAt: null,
          startedAt: new Date('2026-07-12T01:00:00Z'),
          completedAt: new Date('2026-07-12T01:05:00Z'),
          errorMessage: null,
          outputJson: { minutesId: MINUTES_ID },
        },
      ],
    });

    const result = await service.listAiDraftJobs(MEETING_ID, {
      userId: HOST_ID,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ jobId: JOB_ID, status: 'running' });
    expect(result[1]).toMatchObject({
      jobId: MINUTES_ID,
      status: 'completed',
      result: { minutesId: MINUTES_ID },
    });
    expect(jobQb.orderBy).toHaveBeenCalledWith(
      'COALESCE(job.completed_at, job.started_at, job.scheduled_at)',
      'DESC',
      'NULLS FIRST',
    );
  });

  it('AC-008: nguoi khong phai Host va khong phai Admin -> 403', async () => {
    const { service } = buildService({
      meeting: { id: MEETING_ID, hostId: HOST_ID, deletedAt: null },
      adminRows: [],
    });
    await expect(
      service.listAiDraftJobs(MEETING_ID, { userId: OTHER_USER_ID }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Admin (BUSINESS_ADMIN) khong phai Host van xem duoc', async () => {
    const { service } = buildService({
      meeting: { id: MEETING_ID, hostId: HOST_ID, deletedAt: null },
      adminRows: [{ role_code: 'BUSINESS_ADMIN' }],
      jobs: [],
    });
    await expect(
      service.listAiDraftJobs(MEETING_ID, { userId: OTHER_USER_ID }),
    ).resolves.toEqual([]);
  });

  it('AC-009: meeting chua co AI job -> mang rong', async () => {
    const { service } = buildService({ jobs: [] });
    await expect(
      service.listAiDraftJobs(MEETING_ID, { userId: HOST_ID }),
    ).resolves.toEqual([]);
  });

  it('ERR-006: meeting khong ton tai -> 404', async () => {
    const { service } = buildService({ meeting: null });
    await expect(
      service.listAiDraftJobs(MEETING_ID, { userId: HOST_ID }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ── MKM-AI-03: trang thai kha dung tinh nang AI draft cho FE ────────────────
describe('MinutesAiDraftService.getAiDraftAvailability (MKM-AI-03)', () => {
  const buildService = (opts: {
    meeting?: Partial<MeetingEntity> | null;
    config?: Partial<SystemConfigEntity> | null;
    adminRows?: Array<{ role_code: string }>;
  }) => {
    const meetingRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue(
          opts.meeting === undefined
            ? { id: MEETING_ID, hostId: HOST_ID, deletedAt: null }
            : opts.meeting,
        ),
    };
    const configRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue(opts.config === undefined ? null : opts.config),
    };
    const query = jest.fn().mockResolvedValue(opts.adminRows ?? []);
    const manager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === SystemConfigEntity) return configRepo;
        throw new Error('Unexpected entity in test (manager)');
      }),
    };
    const dataSource = {
      manager,
      query,
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === MeetingEntity) return meetingRepo;
        throw new Error('Unexpected entity in test');
      }),
    };
    const service = new MinutesAiDraftService(
      dataSource as never,
      { addJob: jest.fn() } as unknown as QueueService,
    );
    return { service };
  };

  it('AC-001: enabled=true, requireHumanReview=true khi config active', async () => {
    const { service } = buildService({
      config: {
        configKey: 'ai.minutes_summary',
        isActive: true,
        configJson: { enabled: true, requireHumanReview: true },
      },
    });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: HOST_ID }),
    ).resolves.toEqual({ enabled: true, requireHumanReview: true });
  });

  it('AC-002: enabled=false van tra 200 (khong throw)', async () => {
    const { service } = buildService({
      config: {
        configKey: 'ai.minutes_summary',
        isActive: true,
        configJson: { enabled: false, requireHumanReview: true },
      },
    });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: HOST_ID }),
    ).resolves.toEqual({ enabled: false, requireHumanReview: true });
  });

  it('AC-003: thieu config -> fail-safe {enabled:false, requireHumanReview:true}', async () => {
    const { service } = buildService({ config: null });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: HOST_ID }),
    ).resolves.toEqual({ enabled: false, requireHumanReview: true });
  });

  it('AC-004: meeting khong ton tai -> 404', async () => {
    const { service } = buildService({ meeting: null, config: null });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: HOST_ID }),
    ).rejects.toThrow(NotFoundException);
  });

  it('AC-005: khong phai Host va khong phai Admin -> 403', async () => {
    const { service } = buildService({
      meeting: { id: MEETING_ID, hostId: HOST_ID, deletedAt: null },
      config: null,
      adminRows: [],
    });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: OTHER_USER_ID }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('AC-006: BUSINESS_ADMIN khong phai Host van xem duoc', async () => {
    const { service } = buildService({
      meeting: { id: MEETING_ID, hostId: HOST_ID, deletedAt: null },
      config: {
        configKey: 'ai.minutes_summary',
        isActive: true,
        configJson: { enabled: true, requireHumanReview: false },
      },
      adminRows: [{ role_code: 'BUSINESS_ADMIN' }],
    });
    await expect(
      service.getAiDraftAvailability(MEETING_ID, { userId: OTHER_USER_ID }),
    ).resolves.toEqual({ enabled: true, requireHumanReview: false });
  });
});
