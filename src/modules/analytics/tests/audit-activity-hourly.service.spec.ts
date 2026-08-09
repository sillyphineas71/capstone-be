import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditActivityHourlyService } from '../services/audit-activity-hourly.service';
import { AuditActivityHourlyRepository } from '../repositories/audit-activity-hourly.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('AuditActivityHourlyService', () => {
  let service: AuditActivityHourlyService;
  let mockRepo: jest.Mocked<AuditActivityHourlyRepository>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockRepo = {
      countByHour: jest.fn(),
    } as unknown as jest.Mocked<AuditActivityHourlyRepository>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditActivityHourlyService,
        { provide: AuditActivityHourlyRepository, useValue: mockRepo },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<AuditActivityHourlyService>(
      AuditActivityHourlyService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to today (UTC+7) and returns 24 zero-filled buckets when no rows found', async () => {
    mockRepo.countByHour.mockResolvedValue([]);

    const { data } = await service.getHourlyActivity(
      { userId: mockUserId },
      {},
    );

    expect(data.buckets).toHaveLength(24);
    expect(data.buckets[0].hour).toBe('00:00');
    expect(data.buckets[23].hour).toBe('23:00');
    expect(data.totalToday).toBe(0);
    for (const bucket of data.buckets) {
      expect(bucket.count).toBe(0);
    }
  });

  it('uses the explicitly provided date and maps counts into the matching hour buckets', async () => {
    mockRepo.countByHour.mockResolvedValue([
      { hour_of_day: 9, cnt: '45' },
      { hour_of_day: 0, cnt: '2' },
    ]);

    const { data } = await service.getHourlyActivity(
      { userId: mockUserId },
      { date: '2026-08-01' },
    );

    expect(data.date).toBe('2026-08-01');
    expect(data.buckets[9].count).toBe(45);
    expect(data.buckets[0].count).toBe(2);
    expect(data.buckets[1].count).toBe(0);
    expect(data.totalToday).toBe(47);
  });

  it('keeps totalToday equal to the sum of bucket counts', async () => {
    mockRepo.countByHour.mockResolvedValue([
      { hour_of_day: 8, cnt: '10' },
      { hour_of_day: 18, cnt: '3' },
    ]);

    const { data } = await service.getHourlyActivity(
      { userId: mockUserId },
      {},
    );

    const sum = data.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(data.totalToday).toBe(sum);
  });

  it('rejects a date string that is not a real calendar date', async () => {
    await expect(
      service.getHourlyActivity({ userId: mockUserId }, { date: '2026-02-30' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not fail the request when audit logging throws', async () => {
    mockRepo.countByHour.mockResolvedValue([]);
    mockAuditLogsService.logAction.mockRejectedValue(new Error('db down'));

    await expect(
      service.getHourlyActivity({ userId: mockUserId }, {}),
    ).resolves.toBeDefined();
  });
});
