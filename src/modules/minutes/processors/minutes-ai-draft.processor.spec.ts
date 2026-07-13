/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { MinutesAiDraftProcessor } from './minutes-ai-draft.processor.js';
import { LlmProviderFactory } from '../ai/llm-provider.factory.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import {
  TranscriptEntity,
  TranscriptSecurityStatus,
  TranscriptStatus,
} from '../../transcription/entities/transcript.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { AI_MINUTES_JOB_NAME } from '../constants/ai-minutes-draft.constants.js';

const JOB_ID = 'bg-job-1';
const MEETING_ID = 'meeting-1';
const TRANSCRIPT_ID = 'transcript-1';
const USER_ID = 'user-1';
const MINUTES_ID = 'minutes-1';
const SENSITIVE = 'NOI_DUNG_NHAY_CAM_TRANSCRIPT';

const validLlmJson = () =>
  JSON.stringify({
    summary: 'Tóm tắt',
    keyPoints: ['A'],
    decisions: [{ text: 'QD', confidence: 'high', evidence: 'Không xác định' }],
    actionItems: [
      {
        task: 'Việc',
        owner: 'Không xác định',
        deadline: 'Không xác định',
        confidence: 'low',
      },
    ],
    risks: [],
    openQuestions: [],
    uncertainParts: [],
  });

describe('MinutesAiDraftProcessor', () => {
  let processor: MinutesAiDraftProcessor;
  let dataSource: {
    getRepository: jest.Mock;
    transaction: jest.Mock;
  };
  let bgJobsService: {
    markRunning: jest.Mock;
    markFailed: jest.Mock;
    markRetrying: jest.Mock;
  };
  let provider: { generate: jest.Mock };
  let providerFactory: { resolve: jest.Mock };
  let contextRetriever: { retrieve: jest.Mock };

  let configRepo: { findOne: jest.Mock };
  let transcriptRepo: { findOne: jest.Mock };
  let meetingQB: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };
  let meetingRepo: { createQueryBuilder: jest.Mock };
  let minutesRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let bgJobRepo: { update: jest.Mock };
  let auditRepo: { create: jest.Mock; save: jest.Mock };
  let em: { getRepository: jest.Mock };

  const enabledConfig = () => ({
    configKey: 'ai.minutes_summary',
    isActive: true,
    configJson: {
      enabled: true,
      provider: 'mock',
      modelName: 'qwen2.5:7b-instruct',
      maxInputTokens: 6000,
      temperature: 0.2,
    },
  });

  const makeJob = (over: Record<string, unknown> = {}) =>
    ({
      name: AI_MINUTES_JOB_NAME,
      attemptsMade: 0,
      opts: { attempts: 2 },
      data: {
        backgroundJobId: JOB_ID,
        meetingId: MEETING_ID,
        transcriptId: TRANSCRIPT_ID,
        language: 'vi-VN',
        forceRerun: false,
        userId: USER_ID,
        ...over,
      },
    }) as never;

  beforeEach(() => {
    configRepo = { findOne: jest.fn().mockResolvedValue(enabledConfig()) };
    transcriptRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: TRANSCRIPT_ID,
        meetingId: MEETING_ID,
        status: TranscriptStatus.DRAFT,
        securityStatus: TranscriptSecurityStatus.SAFE,
        cleanedText: SENSITIVE,
        rawText: SENSITIVE,
      }),
    };
    meetingQB = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: MEETING_ID,
        title: 'Hop tuan',
        deletedAt: null,
      }),
    };
    meetingRepo = { createQueryBuilder: jest.fn().mockReturnValue(meetingQB) };
    minutesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v) => v),
      save: jest
        .fn()
        .mockImplementation((v) => Promise.resolve({ id: MINUTES_ID, ...v })),
    };
    bgJobRepo = { update: jest.fn().mockResolvedValue(undefined) };
    auditRepo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };

    em = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === BackgroundJobEntity) return bgJobRepo;
        if (entity === AuditLogEntity) return auditRepo;
        throw new Error('Unexpected entity');
      }),
    };

    dataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === SystemConfigEntity) return configRepo;
        if (entity === TranscriptEntity) return transcriptRepo;
        throw new Error('Unexpected root entity');
      }),
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof em) => unknown) => cb(em)),
    };

    bgJobsService = {
      markRunning: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markRetrying: jest.fn().mockResolvedValue(undefined),
    };
    provider = { generate: jest.fn().mockResolvedValue(validLlmJson()) };
    providerFactory = { resolve: jest.fn().mockReturnValue(provider) };
    contextRetriever = { retrieve: jest.fn().mockResolvedValue([]) };

    processor = new MinutesAiDraftProcessor(
      dataSource as never,
      bgJobsService as never,
      { get: jest.fn().mockReturnValue(300000) } as never,
      providerFactory as unknown as LlmProviderFactory,
      contextRetriever,
    );
  });

  it('happy path: INSERT minutes draft + job completed voi output_json.minutesId + audit (AC-001)', async () => {
    const result = await processor.process(makeJob());

    expect(result).toEqual({ success: true, minutesId: MINUTES_ID });
    expect(bgJobsService.markRunning).toHaveBeenCalledWith(JOB_ID);
    expect(minutesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: MEETING_ID,
        status: MeetingMinutesStatus.DRAFT,
        minutesContent: 'Tóm tắt',
        linkedTranscriptId: TRANSCRIPT_ID,
        preparedBy: USER_ID,
        aiSummaryJson: expect.objectContaining({
          meta: expect.objectContaining({
            promptVersion: 'mvp-v2',
            generatedByJobId: JOB_ID,
            provider: 'mock',
          }),
        }),
      }),
    );
    expect(bgJobRepo.update).toHaveBeenCalledWith(
      { id: JOB_ID },
      expect.objectContaining({
        status: BackgroundJobStatus.COMPLETED,
        outputJson: {
          minutesId: MINUTES_ID,
          meetingId: MEETING_ID,
          status: 'draft',
        },
      }),
    );
    expect(auditRepo.save).toHaveBeenCalled();
  });

  it('forceRerun: UPDATE tai cho, versionNo+1, preparedBy doi theo nguoi trigger (AC-007)', async () => {
    const existing = {
      id: MINUTES_ID,
      aiSummaryJson: { meta: {} },
      status: MeetingMinutesStatus.DRAFT,
      versionNo: 1,
      preparedBy: 'old-user',
    };
    minutesRepo.findOne.mockResolvedValue(existing);

    await processor.process(makeJob({ forceRerun: true, userId: 'admin-1' }));

    expect(minutesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MINUTES_ID,
        versionNo: 2,
        preparedBy: 'admin-1',
        minutesContent: 'Tóm tắt',
      }),
    );
    expect(minutesRepo.create).not.toHaveBeenCalled();
  });

  it('TOCTOU: minutes tao tay chen giua (khong forceRerun) -> failed MINUTES_ALREADY_EXISTS, khong ghi de', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: MINUTES_ID,
      aiSummaryJson: null,
      status: MeetingMinutesStatus.DRAFT,
    });

    await processor.process(makeJob());

    expect(bgJobsService.markFailed).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('MINUTES_ALREADY_EXISTS'),
    );
    expect(minutesRepo.save).not.toHaveBeenCalled();
  });

  it('config tat giua chung -> failed AI_SUMMARY_DISABLED (non-retryable, khong throw)', async () => {
    configRepo.findOne.mockResolvedValue(null);
    await expect(processor.process(makeJob())).resolves.toBeUndefined();
    expect(bgJobsService.markFailed).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('AI_SUMMARY_DISABLED'),
    );
  });

  it('transcript qua dai -> failed TRANSCRIPT_TOO_LONG_FOR_MVP non-retryable (ERR-010)', async () => {
    transcriptRepo.findOne.mockResolvedValue({
      id: TRANSCRIPT_ID,
      meetingId: MEETING_ID,
      status: TranscriptStatus.DRAFT,
      securityStatus: TranscriptSecurityStatus.SAFE,
      cleanedText: 'x'.repeat(6000 * 3 + 10), // vượt maxInputTokens=6000 (chars/3)
      rawText: null,
    });

    await processor.process(makeJob());

    expect(bgJobsService.markFailed).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('TRANSCRIPT_TOO_LONG_FOR_MVP'),
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('output sai schema lan 1, repair thanh cong -> completed (FR-019)', async () => {
    provider.generate
      .mockResolvedValueOnce('khong phai json')
      .mockResolvedValueOnce(validLlmJson());

    const result = await processor.process(makeJob());

    expect(provider.generate).toHaveBeenCalledTimes(2);
    const repairPrompt = String(
      (provider.generate.mock.calls as unknown as string[][])[1][0],
    );
    expect(repairPrompt).toContain('KHÔNG hợp lệ');
    expect(result).toEqual({ success: true, minutesId: MINUTES_ID });
  });

  it('output sai schema ca sau repair -> failed AI_OUTPUT_INVALID_SCHEMA, khong retry, khong ghi DB (AC-010)', async () => {
    provider.generate.mockResolvedValue('van khong phai json');

    await expect(processor.process(makeJob())).resolves.toBeUndefined();

    expect(provider.generate).toHaveBeenCalledTimes(2); // 1 lan chinh + 1 repair
    expect(bgJobsService.markFailed).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('AI_OUTPUT_INVALID_SCHEMA'),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(bgJobsService.markRetrying).not.toHaveBeenCalled();
  });

  it('LLM timeout (attempt 1/2) -> markRetrying + throw de BullMQ retry (AC-009)', async () => {
    provider.generate.mockRejectedValue(new Error('fetch timeout'));

    await expect(processor.process(makeJob())).rejects.toThrow('fetch timeout');
    expect(bgJobsService.markRetrying).toHaveBeenCalledWith(JOB_ID);
    expect(bgJobsService.markFailed).not.toHaveBeenCalled();
  });

  it('LLM timeout het attempts -> failed LLM_UNAVAILABLE, khong throw (AC-009)', async () => {
    provider.generate.mockRejectedValue(new Error('fetch timeout'));
    const lastAttemptJob = makeJob();
    (lastAttemptJob as { attemptsMade: number }).attemptsMade = 1; // attempt 2/2

    await expect(processor.process(lastAttemptJob)).resolves.toBeUndefined();
    expect(bgJobsService.markFailed).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('LLM_UNAVAILABLE'),
    );
  });

  it('job name la -> ACK bo qua, khong cham DB', async () => {
    const weird = makeJob();
    (weird as { name: string }).name = 'khac:job';
    await processor.process(weird);
    expect(bgJobsService.markRunning).not.toHaveBeenCalled();
  });

  it('FR-025/AC-011: moi nhanh (thanh cong + that bai) khong log noi dung transcript', async () => {
    const logs: string[] = [];
    const internalLogger = (
      processor as unknown as {
        logger: {
          log: (m: string) => void;
          error: (m: string) => void;
          warn: (m: string) => void;
        };
      }
    ).logger;
    jest.spyOn(internalLogger, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });
    jest.spyOn(internalLogger, 'error').mockImplementation((m) => {
      logs.push(String(m));
    });
    jest.spyOn(internalLogger, 'warn').mockImplementation((m) => {
      logs.push(String(m));
    });

    // Nhánh thành công
    await processor.process(makeJob());
    // Nhánh thất bại schema
    provider.generate.mockResolvedValue('sai json');
    await processor.process(makeJob());

    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(SENSITIVE);
      expect(line).not.toContain('Tóm tắt'); // không log summary
    }
  });
});
