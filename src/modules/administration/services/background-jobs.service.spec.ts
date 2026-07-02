import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BackgroundJobsService } from './background-jobs.service.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
  BackgroundJobType,
} from '../entities/background-job.entity.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('BackgroundJobsService', () => {
  let service: BackgroundJobsService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    increment: jest.fn(),
    findOne: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackgroundJobsService,
        {
          provide: getRepositoryToken(BackgroundJobEntity),
          useValue: mockRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BackgroundJobsService>(BackgroundJobsService);
  });

  describe('createQueuedJob()', () => {
    it('should create and save a job with QUEUED status', async () => {
      const mockJob = { id: 'job-uuid', status: BackgroundJobStatus.QUEUED };
      mockRepo.create.mockReturnValue(mockJob);
      mockRepo.save.mockResolvedValue(mockJob);

      const result = await service.createQueuedJob({
        jobType: BackgroundJobType.SEND_EMAIL,
        queueName: 'notification',
        requestedBy: 'user-uuid',
      });

      expect(result.status).toBe(BackgroundJobStatus.QUEUED);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: BackgroundJobType.SEND_EMAIL,
          status: BackgroundJobStatus.QUEUED,
          retryCount: 0,
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('markRunning()', () => {
    it('should update job to RUNNING with startedAt', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markRunning('job-id');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'job-id',
        expect.objectContaining({
          status: BackgroundJobStatus.RUNNING,
          startedAt: expect.any(Date),
        }),
      );
    });
  });

  describe('markCompleted()', () => {
    it('should update job to COMPLETED with output', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markCompleted('job-id', { result: 'ok' });
      expect(mockRepo.update).toHaveBeenCalledWith(
        'job-id',
        expect.objectContaining({
          status: BackgroundJobStatus.COMPLETED,
          outputJson: { result: 'ok' },
          errorMessage: null,
        }),
      );
    });
  });

  describe('markFailed()', () => {
    it('should update job to FAILED with error message', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markFailed('job-id', 'SMTP timeout');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'job-id',
        expect.objectContaining({
          status: BackgroundJobStatus.FAILED,
          errorMessage: 'SMTP timeout',
        }),
      );
    });
  });

  describe('markRetrying()', () => {
    it('should increment retryCount and set RETRYING status', async () => {
      mockRepo.increment.mockResolvedValue({ affected: 1 });
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markRetrying('job-id');
      expect(mockRepo.increment).toHaveBeenCalledWith(
        { id: 'job-id' },
        'retryCount',
        1,
      );
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', {
        status: BackgroundJobStatus.RETRYING,
      });
    });
  });

  describe('cancelJob()', () => {
    it('should update job to CANCELLED', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.cancelJob('job-id');
      expect(mockRepo.update).toHaveBeenCalledWith(
        'job-id',
        expect.objectContaining({
          status: BackgroundJobStatus.CANCELLED,
        }),
      );
    });
  });

  describe('findById()', () => {
    it('should return job if found', async () => {
      const mockJob = { id: 'job-uuid' };
      mockRepo.findOne.mockResolvedValue(mockJob);
      const result = await service.findById('job-uuid');
      expect(result).toBe(mockJob);
    });

    it('should throw NotFoundException if not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getJobStatusForUser() — T007', () => {
    const OWNER = 'owner-uuid';
    const baseJob: Partial<BackgroundJobEntity> = {
      id: 'job-uuid',
      jobType: BackgroundJobType.TRANSCRIPTION,
      status: BackgroundJobStatus.RUNNING,
      relatedEntityType: 'meeting',
      relatedEntityId: 'meeting-uuid',
      requestedBy: OWNER,
      retryCount: 0,
      scheduledAt: null,
      startedAt: new Date('2026-06-30T10:00:00Z'),
      completedAt: null,
      errorMessage: null,
      outputJson: null,
      outputFileId: null,
    };

    it('owner xem được job của mình — không cần check role', async () => {
      mockRepo.findOne.mockResolvedValue(baseJob);

      const result = await service.getJobStatusForUser('job-uuid', OWNER);

      expect(result.jobId).toBe('job-uuid');
      expect(result.status).toBe(BackgroundJobStatus.RUNNING);
      expect(result.relatedEntityId).toBe('meeting-uuid');
      // owner -> không truy vấn role
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });

    it('không phải owner nhưng là admin (BUSINESS_ADMIN/SYSTEM_ADMIN) → xem được', async () => {
      mockRepo.findOne.mockResolvedValue(baseJob);
      mockDataSource.query.mockResolvedValue([{ role_code: 'SYSTEM_ADMIN' }]);

      const result = await service.getJobStatusForUser(
        'job-uuid',
        'other-admin',
      );

      expect(result.jobId).toBe('job-uuid');
      expect(mockDataSource.query).toHaveBeenCalledTimes(1);
    });

    it('không phải owner và không phải admin → ForbiddenException (PERMISSION_DENIED)', async () => {
      mockRepo.findOne.mockResolvedValue(baseJob);
      mockDataSource.query.mockResolvedValue([]); // không có role admin

      await expect(
        service.getJobStatusForUser('job-uuid', 'stranger'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('job không tồn tại → NotFoundException (BACKGROUND_JOB_NOT_FOUND)', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getJobStatusForUser('missing', OWNER),
      ).rejects.toThrow(NotFoundException);
    });

    it('status=completed → trả result (outputJson), errorMessage=null', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...baseJob,
        status: BackgroundJobStatus.COMPLETED,
        outputJson: { transcriptId: 'tr-1', status: 'draft' },
        completedAt: new Date('2026-06-30T10:05:00Z'),
      });

      const result = await service.getJobStatusForUser('job-uuid', OWNER);

      expect(result.status).toBe(BackgroundJobStatus.COMPLETED);
      expect(result.result).toEqual({ transcriptId: 'tr-1', status: 'draft' });
      expect(result.errorMessage).toBeNull();
    });

    it('status=failed → trả errorMessage, result=null', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...baseJob,
        status: BackgroundJobStatus.FAILED,
        errorMessage: 'AI_WORKER_FAILED: SOURCE_MEDIA_NOT_FOUND',
        outputJson: { leak: 'should-not-surface' },
      });

      const result = await service.getJobStatusForUser('job-uuid', OWNER);

      expect(result.status).toBe(BackgroundJobStatus.FAILED);
      expect(result.errorMessage).toBe(
        'AI_WORKER_FAILED: SOURCE_MEDIA_NOT_FOUND',
      );
      // outputJson chỉ surface khi completed — failed thì result=null
      expect(result.result).toBeNull();
    });

    it('view KHÔNG chứa field nội bộ (requestedBy/inputJson/metadataJson)', async () => {
      mockRepo.findOne.mockResolvedValue({
        ...baseJob,
        inputJson: { sourceMediaFileId: 'secret', storageKey: 'k' },
        metadataJson: { internal: true },
      });

      const result = await service.getJobStatusForUser('job-uuid', OWNER);

      expect(result).not.toHaveProperty('requestedBy');
      expect(result).not.toHaveProperty('inputJson');
      expect(result).not.toHaveProperty('metadataJson');
    });
  });
});
