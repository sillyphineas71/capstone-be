/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { ZonePresenceTimelineService } from './zone-presence-timeline.service.js';

describe('ZonePresenceTimelineService (ZPT-001 / UC-119)', () => {
  let service: ZonePresenceTimelineService;
  let zoneRepo: any;
  let presenceRepo: any;

  const event = (over: any = {}): any => ({
    id: 'evt-1',
    eventType: 'appear',
    occupancyCount: null,
    userId: null,
    eventTime: new Date('2026-07-23T08:00:00Z'),
    ...over,
  });

  const build = () => {
    zoneRepo = { findOne: jest.fn().mockResolvedValue({ id: 'zone-1' }) };
    presenceRepo = { find: jest.fn().mockResolvedValue([]) };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZonePresenceTimelineService,
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
        {
          provide: getRepositoryToken(ZonePresenceEventEntity),
          useValue: presenceRepo,
        },
      ],
    }).compile();
    service = module.get(ZonePresenceTimelineService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  const from = new Date('2026-07-23T00:00:00Z');
  const to = new Date('2026-07-23T23:59:59Z');

  it('zone không tồn tại/đã xóa mềm → 404 ZONE_NOT_FOUND', async () => {
    zoneRepo.findOne.mockResolvedValue(null);
    await expect(service.getTimeline('zone-x', from, to)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('range >31 ngày → 400 INVALID_TIMELINE_RANGE', async () => {
    const farTo = new Date('2026-09-30T00:00:00Z'); // > 31 ngày kể từ from
    await expect(service.getTimeline('zone-1', from, farTo)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('không có event nào → EX1 rỗng kèm message, KHÔNG lỗi', async () => {
    presenceRepo.find.mockResolvedValue([]);
    const result = await service.getTimeline('zone-1', from, to);
    expect(result).toEqual({
      events: [],
      personDataAvailable: null,
      totalDurationSeconds: null,
      ongoing: false,
      message: 'Không có dữ liệu hiện diện trong khoảng thời gian này.',
    });
  });

  it('không truyền userId, toàn bộ event userId=NULL → personDataAvailable=false, totalDurationSeconds=null', async () => {
    presenceRepo.find.mockResolvedValue([
      event(),
      event({ eventType: 'disappear' }),
    ]);
    const result = await service.getTimeline('zone-1', from, to);
    expect(result.personDataAvailable).toBe(false);
    expect(result.totalDurationSeconds).toBeNull();
  });

  it('có userId + 1 cặp enter/exit → tính đúng totalDurationSeconds, ongoing=false', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'disappear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:10:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.personDataAvailable).toBe(true);
    expect(result.totalDurationSeconds).toBe(600); // 10 phút
    expect(result.ongoing).toBe(false);
  });

  it('nhiều cặp liên tiếp → cộng dồn đúng tổng', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'disappear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:05:00Z'),
      }),
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T09:00:00Z'),
      }),
      event({
        eventType: 'disappear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T09:20:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.totalDurationSeconds).toBe(300 + 1200);
  });

  it('enter cuối KHÔNG có exit theo sau → ongoing=true, KHÔNG cộng vào tổng', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'disappear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:05:00Z'),
      }),
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T09:00:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.totalDurationSeconds).toBe(300);
    expect(result.ongoing).toBe(true);
  });

  it('2 enter liên tiếp không exit ở giữa → enter mới đè enter cũ (chỉ 1 phiên mở)', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:30:00Z'),
      }),
      event({
        eventType: 'disappear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:40:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    // Tính từ enter thứ 2 (08:30) → exit (08:40) = 600s, KHÔNG tính từ enter đầu (08:00)
    expect(result.totalDurationSeconds).toBe(600);
    expect(result.ongoing).toBe(false);
  });
});
