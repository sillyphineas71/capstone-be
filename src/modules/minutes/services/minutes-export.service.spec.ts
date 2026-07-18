/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { MinutesExportService } from './minutes-export.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { QueueService } from '../../queue/queue.service.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import {
  MINUTES_EXPORT_QUEUE_NAME,
  MINUTES_EXPORT_JOB_NAME,
} from '../constants/minutes-export-job.constants.js';

describe('MinutesExportService.createExportJob', () => {
  const minutesId = 'minutes-1';
  const meetingId = 'meeting-1';
  const hostId = 'host-1';
  const preparedBy = 'preparer-1';

  let minutesRow: Partial<MeetingMinutesEntity> | null;
  let meetingRow: Partial<MeetingEntity> | null;
  let roles: string[];
  let createQueuedJob: jest.Mock;
  let addJob: jest.Mock;
  let service: MinutesExportService;

  beforeEach(() => {
    minutesRow = {
      id: minutesId,
      meetingId,
      preparedBy,
      status: MeetingMinutesStatus.PUBLISHED,
      deletedAt: null,
    };
    meetingRow = { id: meetingId, hostId };
    roles = [];
    createQueuedJob = jest.fn().mockResolvedValue({ id: 'job-1' });
    addJob = jest.fn().mockResolvedValue('bull-1');

    const dataSource = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === MeetingMinutesEntity) {
          return { findOne: jest.fn().mockImplementation(() => Promise.resolve(minutesRow)) };
        }
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockImplementation(() => Promise.resolve(meetingRow)) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      }),
    } as unknown as DataSource;

    const authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ roles, permissions: [] })),
    } as unknown as AuthzReadRepository;

    const backgroundJobsService = {
      createQueuedJob,
    } as unknown as BackgroundJobsService;

    const queueService = { addJob } as unknown as QueueService;

    service = new MinutesExportService(
      dataSource,
      authzRepo,
      backgroundJobsService,
      queueService,
    );
  });

  it('[AC-001] preparer exports published minutes → 202 + job queued', async () => {
    const res = await service.createExportJob(
      minutesId,
      { format: 'pdf' },
      { userId: preparedBy },
    );
    expect(res.jobId).toBe('job-1');
    expect(res.status).toBe('queued');
    expect(res.format).toBe('pdf');
    expect(createQueuedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: BackgroundJobType.EXPORT_MINUTES,
        relatedEntityId: minutesId,
      }),
    );
    expect(addJob).toHaveBeenCalledWith(
      MINUTES_EXPORT_QUEUE_NAME,
      MINUTES_EXPORT_JOB_NAME,
      expect.objectContaining({ backgroundJobId: 'job-1', format: 'pdf' }),
    );
  });

  it('[AC-003] business admin can export (bypass ownership)', async () => {
    roles = ['BUSINESS_ADMIN'];
    const res = await service.createExportJob(
      minutesId,
      { format: 'docx' },
      { userId: 'admin-x' },
    );
    expect(res.jobId).toBe('job-1');
  });

  it('applies defaults includeTranscript=false, includeActionItems=true', async () => {
    await service.createExportJob(minutesId, { format: 'pdf' }, { userId: preparedBy });
    expect(addJob).toHaveBeenCalledWith(
      MINUTES_EXPORT_QUEUE_NAME,
      MINUTES_EXPORT_JOB_NAME,
      expect.objectContaining({ includeTranscript: false, includeActionItems: true }),
    );
  });

  it('[AC-007] non-owner non-admin → 403 NOT_MINUTES_OWNER', async () => {
    await expect(
      service.createExportJob(minutesId, { format: 'pdf' }, { userId: 'stranger' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createQueuedJob).not.toHaveBeenCalled();
  });

  it('[AC-010] draft minutes → 409 MINUTES_NOT_PUBLISHED', async () => {
    minutesRow!.status = MeetingMinutesStatus.DRAFT;
    await expect(
      service.createExportJob(minutesId, { format: 'pdf' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('[AC-016] nonexistent minutes → 404 MINUTES_NOT_FOUND', async () => {
    minutesRow = null;
    await expect(
      service.createExportJob(minutesId, { format: 'pdf' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[AC-017] soft-deleted minutes → 404 MINUTES_NOT_FOUND', async () => {
    minutesRow!.deletedAt = new Date();
    await expect(
      service.createExportJob(minutesId, { format: 'pdf' }, { userId: preparedBy }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
