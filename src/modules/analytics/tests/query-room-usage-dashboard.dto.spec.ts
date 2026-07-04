import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryRoomUsageDashboardDto } from '../dto/query-room-usage-dashboard.dto';
import { QueryRoomDetailDto } from '../dto/query-room-detail.dto';

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';

describe('QueryRoomUsageDashboardDto & QueryRoomDetailDto', () => {
  describe('QueryRoomUsageDashboardDto', () => {
    it('valid params -> passes', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {
        preset: 'month',
        from: '2026-06-01',
        to: '2026-06-30',
        roomId: UUID_V4,
        siteName: 'Building A',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('empty params -> passes (all optional)', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('invalid preset -> error', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {
        preset: 'hour',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('invalid from format -> error', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {
        from: 'not-a-date',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('invalid roomId (not UUID) -> error', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {
        roomId: 'not-uuid',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('siteName too long -> error', async () => {
      const dto = plainToInstance(QueryRoomUsageDashboardDto, {
        siteName: 'a'.repeat(151),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('QueryRoomDetailDto', () => {
    it('valid params -> passes', async () => {
      const dto = plainToInstance(QueryRoomDetailDto, {
        preset: 'week',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
