/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { VehicleTrafficStatsService } from './vehicle-traffic-stats.service.js';

describe('VehicleTrafficStatsService (VTS-001 / UC-114)', () => {
  let service: VehicleTrafficStatsService;
  let query: jest.Mock;
  let dataSource: any;

  beforeEach(() => {
    query = jest.fn();
    dataSource = { manager: { query } };
    service = new VehicleTrafficStatsService(dataSource);
  });

  describe('getStats', () => {
    it('from > to → 400 INVALID_DATE_RANGE, KHÔNG gọi manager.query', async () => {
      await expect(
        service.getStats({
          from: '2026-07-31T00:00:00Z',
          to: '2026-07-01T00:00:00Z',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    });

    it('event_type=ivss_vehicle_event LUÔN là điều kiện đầu tiên trong CẢ HAI query', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      const summarySql = query.mock.calls[0][0] as string;
      const seriesSql = query.mock.calls[1][0] as string;
      expect(summarySql).toMatch(
        /^SELECT[\s\S]*WHERE event_type = 'ivss_vehicle_event'/,
      );
      expect(seriesSql).toContain(`event_type = 'ivss_vehicle_event'`);
    });

    it('filter zoneId/vehicleType áp dụng đúng khi có', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
        zoneId: 'z1',
        vehicleType: 'car',
      });
      const sql = query.mock.calls[0][0] as string;
      const params = query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('zone_id = $3');
      expect(sql).toContain(`payload_json->>'vehicleType' = $4`);
      expect(params).toEqual([
        '2026-07-01T00:00:00Z',
        '2026-07-31T23:59:59Z',
        'z1',
        'car',
      ]);
    });

    it('KHÔNG filter zoneId/vehicleType → WHERE không chứa điều kiện đó', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      const sql = query.mock.calls[0][0] as string;
      expect(sql).not.toContain('zone_id');
      expect(sql).not.toContain('vehicleType');
    });

    it('group_by=hour → bucketExpr theo giờ', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
        groupBy: 'hour',
      } as any);
      const seriesSql = query.mock.calls[1][0] as string;
      expect(seriesSql).toContain("to_char(event_time, 'YYYY-MM-DD HH24:00')");
    });

    it('group_by absent → bucketExpr theo ngày (default)', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      const seriesSql = query.mock.calls[1][0] as string;
      expect(seriesSql).toContain("to_char(event_time, 'YYYY-MM-DD')");
      expect(seriesSql).not.toContain('HH24');
    });

    it('không có dữ liệu → summary toàn 0, series rỗng, KHÔNG throw', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const r = await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      expect(r.summary).toEqual({
        total_events: 0,
        total_matched: 0,
        total_unmatched: 0,
        total_enter: 0,
        total_leave: 0,
        total_seen: 0,
        unique_vehicles: 0,
      });
      expect(r.series).toEqual([]);
    });

    it('summary map đúng field từ raw row', async () => {
      query
        .mockResolvedValueOnce([
          {
            total: 100,
            matched: 80,
            unmatched: 20,
            enter_count: 45,
            leave_count: 40,
            seen_count: 15,
            unique_vehicles: 30,
          },
        ])
        .mockResolvedValueOnce([]);
      const r = await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      expect(r.summary).toEqual({
        total_events: 100,
        total_matched: 80,
        total_unmatched: 20,
        total_enter: 45,
        total_leave: 40,
        total_seen: 15,
        unique_vehicles: 30,
      });
    });

    it('pivotSeries: bucket thiếu 1-2 hướng → hướng thiếu = 0', async () => {
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { bucket: '2026-07-01', direction: 'enter', cnt: 5 },
        { bucket: '2026-07-02', direction: 'leave', cnt: 3 },
        { bucket: '2026-07-02', direction: 'seen', cnt: 1 },
      ]);
      const r = await service.getStats({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      expect(r.series).toEqual([
        { bucket: '2026-07-01', enter: 5, leave: 0, seen: 0 },
        { bucket: '2026-07-02', enter: 0, leave: 3, seen: 1 },
      ]);
    });
  });
});
