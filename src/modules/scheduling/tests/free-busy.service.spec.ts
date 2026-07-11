import { Test, TestingModule } from '@nestjs/testing';
import { getEntityManagerToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { FreeBusyService, Interval } from '../services/free-busy.service.js';

describe('FreeBusyService', () => {
  let service: FreeBusyService;
  const mockQuery = jest.fn();

  beforeEach(async () => {
    mockQuery.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FreeBusyService,
        { provide: getEntityManagerToken(), useValue: { query: mockQuery } },
      ],
    }).compile();
    service = module.get<FreeBusyService>(FreeBusyService);
  });

  const d = (iso: string) => new Date(iso);

  describe('mergeIntervals', () => {
    it('merges overlapping intervals into one', () => {
      const intervals: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T10:00:00Z') },
        { start: d('2026-07-13T09:30:00Z'), end: d('2026-07-13T11:00:00Z') },
      ];
      const merged = service.mergeIntervals(intervals);
      expect(merged).toHaveLength(1);
      expect(merged[0].start).toEqual(d('2026-07-13T09:00:00Z'));
      expect(merged[0].end).toEqual(d('2026-07-13T11:00:00Z'));
    });

    it('keeps disjoint intervals separate', () => {
      const intervals: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T10:00:00Z') },
        { start: d('2026-07-13T11:00:00Z'), end: d('2026-07-13T12:00:00Z') },
      ];
      const merged = service.mergeIntervals(intervals);
      expect(merged).toHaveLength(2);
    });

    it('merges back-to-back adjacent intervals (touching endpoints)', () => {
      const intervals: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T10:00:00Z') },
        { start: d('2026-07-13T10:00:00Z'), end: d('2026-07-13T11:00:00Z') },
      ];
      const merged = service.mergeIntervals(intervals);
      expect(merged).toHaveLength(1);
    });
  });

  describe('complement', () => {
    it('returns the whole range when there is no busy interval', () => {
      const free = service.complement(
        [],
        d('2026-07-13T08:00:00Z'),
        d('2026-07-13T18:00:00Z'),
      );
      expect(free).toEqual([
        { start: d('2026-07-13T08:00:00Z'), end: d('2026-07-13T18:00:00Z') },
      ]);
    });

    it('computes the gap between two busy intervals', () => {
      const busy: Interval[] = [
        { start: d('2026-07-13T08:00:00Z'), end: d('2026-07-13T09:00:00Z') },
        { start: d('2026-07-13T11:00:00Z'), end: d('2026-07-13T12:00:00Z') },
      ];
      const free = service.complement(
        busy,
        d('2026-07-13T08:00:00Z'),
        d('2026-07-13T18:00:00Z'),
      );
      expect(free).toEqual([
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T11:00:00Z') },
        { start: d('2026-07-13T12:00:00Z'), end: d('2026-07-13T18:00:00Z') },
      ]);
    });

    it('returns empty when fully busy', () => {
      const busy: Interval[] = [
        { start: d('2026-07-13T08:00:00Z'), end: d('2026-07-13T18:00:00Z') },
      ];
      const free = service.complement(
        busy,
        d('2026-07-13T08:00:00Z'),
        d('2026-07-13T18:00:00Z'),
      );
      expect(free).toEqual([]);
    });
  });

  describe('intersectAll', () => {
    it('intersects two free-interval sets to find common free time', () => {
      const userA: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T11:00:00Z') },
      ];
      const userB: Interval[] = [
        { start: d('2026-07-13T10:00:00Z'), end: d('2026-07-13T12:00:00Z') },
      ];
      const result = service.intersectAll([userA, userB]);
      expect(result).toEqual([
        { start: d('2026-07-13T10:00:00Z'), end: d('2026-07-13T11:00:00Z') },
      ]);
    });

    it('returns empty when there is no common overlap across 3 users', () => {
      const userA: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T10:00:00Z') },
      ];
      const userB: Interval[] = [
        { start: d('2026-07-13T10:00:00Z'), end: d('2026-07-13T11:00:00Z') },
      ];
      const userC: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T12:00:00Z') },
      ];
      const result = service.intersectAll([userA, userB, userC]);
      expect(result).toEqual([]);
    });
  });

  describe('overlapsAny', () => {
    it('detects overlap with a candidate slot', () => {
      const busy: Interval[] = [
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T10:00:00Z') },
      ];
      expect(
        service.overlapsAny(
          busy,
          d('2026-07-13T09:30:00Z'),
          d('2026-07-13T10:30:00Z'),
        ),
      ).toBe(true);
      expect(
        service.overlapsAny(
          busy,
          d('2026-07-13T10:00:00Z'),
          d('2026-07-13T11:00:00Z'),
        ),
      ).toBe(false);
    });
  });

  describe('getBusyIntervalsByUser', () => {
    it('groups and merges busy rows per user from the query result', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          user_id: 'u1',
          start_time: '2026-07-13T09:00:00Z',
          end_time: '2026-07-13T10:00:00Z',
        },
        {
          user_id: 'u1',
          start_time: '2026-07-13T09:30:00Z',
          end_time: '2026-07-13T11:00:00Z',
        },
        {
          user_id: 'u2',
          start_time: '2026-07-13T14:00:00Z',
          end_time: '2026-07-13T15:00:00Z',
        },
      ]);

      const result = await service.getBusyIntervalsByUser(
        ['u1', 'u2'],
        d('2026-07-13T00:00:00Z'),
        d('2026-07-13T23:59:59Z'),
        null,
      );

      expect(result.get('u1')).toEqual([
        { start: d('2026-07-13T09:00:00Z'), end: d('2026-07-13T11:00:00Z') },
      ]);
      expect(result.get('u2')).toEqual([
        { start: d('2026-07-13T14:00:00Z'), end: d('2026-07-13T15:00:00Z') },
      ]);
    });

    it('returns empty arrays for users with no busy meetings', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.getBusyIntervalsByUser(
        ['u1'],
        d('2026-07-13T00:00:00Z'),
        d('2026-07-13T23:59:59Z'),
        null,
      );
      expect(result.get('u1')).toEqual([]);
    });

    it('does not query when userIds is empty', async () => {
      const result = await service.getBusyIntervalsByUser(
        [],
        d('2026-07-13T00:00:00Z'),
        d('2026-07-13T23:59:59Z'),
        null,
      );
      expect(mockQuery).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });
  });
});
