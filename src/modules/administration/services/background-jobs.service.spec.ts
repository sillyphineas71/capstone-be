import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BackgroundJobsService } from './background-jobs.service.js';
import { BackgroundJobEntity, BackgroundJobStatus, BackgroundJobType } from '../entities/background-job.entity.js';
import { NotFoundException } from '@nestjs/common';

describe('BackgroundJobsService', () => {
  let service: BackgroundJobsService;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    increment: jest.fn(),
    findOne: jest.fn(),
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
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', expect.objectContaining({
        status: BackgroundJobStatus.RUNNING,
        startedAt: expect.any(Date),
      }));
    });
  });

  describe('markCompleted()', () => {
    it('should update job to COMPLETED with output', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markCompleted('job-id', { result: 'ok' });
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', expect.objectContaining({
        status: BackgroundJobStatus.COMPLETED,
        outputJson: { result: 'ok' },
        errorMessage: null,
      }));
    });
  });

  describe('markFailed()', () => {
    it('should update job to FAILED with error message', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markFailed('job-id', 'SMTP timeout');
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', expect.objectContaining({
        status: BackgroundJobStatus.FAILED,
        errorMessage: 'SMTP timeout',
      }));
    });
  });

  describe('markRetrying()', () => {
    it('should increment retryCount and set RETRYING status', async () => {
      mockRepo.increment.mockResolvedValue({ affected: 1 });
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markRetrying('job-id');
      expect(mockRepo.increment).toHaveBeenCalledWith({ id: 'job-id' }, 'retryCount', 1);
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', { status: BackgroundJobStatus.RETRYING });
    });
  });

  describe('cancelJob()', () => {
    it('should update job to CANCELLED', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.cancelJob('job-id');
      expect(mockRepo.update).toHaveBeenCalledWith('job-id', expect.objectContaining({
        status: BackgroundJobStatus.CANCELLED,
      }));
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
      await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
    });
  });
});
