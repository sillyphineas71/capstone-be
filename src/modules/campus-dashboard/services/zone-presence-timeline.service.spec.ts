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
      sightingCount: null,
      message: 'Không có dữ liệu hiện diện trong khoảng thời gian này.',
    });
  });

  it('không truyền userId, toàn bộ event userId=NULL → personDataAvailable=false, sightingCount=null', async () => {
    presenceRepo.find.mockResolvedValue([
      event(),
      event({ eventType: 'disappear' }),
    ]);
    const result = await service.getTimeline('zone-1', from, to);
    expect(result.personDataAvailable).toBe(false);
    expect(result.sightingCount).toBeNull();
  });

  it('không truyền userId, có event userId khác NULL → personDataAvailable=true, sightingCount vẫn null', async () => {
    presenceRepo.find.mockResolvedValue([event({ userId: 'u1' })]);
    const result = await service.getTimeline('zone-1', from, to);
    expect(result.personDataAvailable).toBe(true);
    expect(result.sightingCount).toBeNull();
  });

  it('có userId + 1 lượt appear → sightingCount=1, personDataAvailable=true', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.personDataAvailable).toBe(true);
    expect(result.sightingCount).toBe(1);
  });

  it('có userId + nhiều lượt appear → sightingCount đúng bằng tổng số event trả về', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T09:00:00Z'),
      }),
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T09:20:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.sightingCount).toBe(3);
    expect(result.events).toHaveLength(3);
  });

  it('events trả về đúng thứ tự eventTime ASC và giữ nguyên eventType/occupancyCount', async () => {
    presenceRepo.find.mockResolvedValue([
      event({
        eventType: 'appear',
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      }),
      event({
        eventType: 'count',
        occupancyCount: 5,
        userId: 'u1',
        eventTime: new Date('2026-07-23T08:05:00Z'),
      }),
    ]);
    const result = await service.getTimeline('zone-1', from, to, 'u1');
    expect(result.events[0].eventType).toBe('appear');
    expect(result.events[1]).toMatchObject({
      eventType: 'count',
      occupancyCount: 5,
    });
  });

  // [2026-08-22] isStranger — mirror công thức RAL-001/ALS-002 (userId===null) NHƯNG
  // chỉ áp dụng cho eventType='appear', tránh gắn nhầm 'count' (luôn userId=null theo
  // thiết kế writeCountEvent(), không phải "không nhận diện được").
  describe('[2026-08-22] isStranger (eventType=appear + userId null)', () => {
    it('appear + userId=null (người lạ thật) → isStranger=true', async () => {
      presenceRepo.find.mockResolvedValue([
        event({ eventType: 'appear', userId: null }),
      ]);
      const result = await service.getTimeline('zone-1', from, to);
      expect(result.events[0].isStranger).toBe(true);
    });

    it('appear + userId có giá trị (người quen) → isStranger=false', async () => {
      presenceRepo.find.mockResolvedValue([
        event({ eventType: 'appear', userId: 'u1' }),
      ]);
      const result = await service.getTimeline('zone-1', from, to);
      expect(result.events[0].isStranger).toBe(false);
    });

    it('QUAN TRỌNG NHẤT — count (đếm người, userId luôn null theo thiết kế) → isStranger=false, KHÔNG gắn nhầm "Người lạ"', async () => {
      presenceRepo.find.mockResolvedValue([
        event({ eventType: 'count', occupancyCount: 5, userId: null }),
      ]);
      const result = await service.getTimeline('zone-1', from, to);
      expect(result.events[0].isStranger).toBe(false);
    });

    it('disappear + userId=null → isStranger=false (chỉ appear mới tính, mirror thiết kế hiện tại — disappear chưa có writer nào tạo ra nhưng vẫn phải an toàn nếu xuất hiện)', async () => {
      presenceRepo.find.mockResolvedValue([
        event({ eventType: 'disappear', userId: null }),
      ]);
      const result = await service.getTimeline('zone-1', from, to);
      expect(result.events[0].isStranger).toBe(false);
    });
  });
});
