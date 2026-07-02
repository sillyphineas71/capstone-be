import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MyScheduleQueryDto } from './my-schedule-query.dto.js';

describe('MyScheduleQueryDto Validation', () => {
  describe('valid params pass', () => {
    it('[T043] should accept valid schedule query params', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        status: ['scheduled', 'in_progress'],
        role: 'organizer',
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        q: 'sprint',
      });
      const errors = await validate(dto);
      const nonDateErrors = errors.filter(
        (e) => e.property !== 'from' && e.property !== 'to',
      );
      expect(nonDateErrors.length).toBe(0);
    });
  });

  describe('view param', () => {
    it('[T043] should fail with invalid view=year', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'year',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      });
      const errors = await validate(dto);
      const viewErrors = errors.filter((e) => e.property === 'view');
      expect(viewErrors.length).toBeGreaterThan(0);
    });

    it('[T043] should fail with missing view', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      });
      const errors = await validate(dto);
      const viewErrors = errors.filter((e) => e.property === 'view');
      expect(viewErrors.length).toBeGreaterThan(0);
    });
  });

  describe('from/to params', () => {
    it('[T043] should fail with missing from', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        to: '2026-06-15T00:00:00.000Z',
      });
      const errors = await validate(dto);
      const fromErrors = errors.filter((e) => e.property === 'from');
      expect(fromErrors.length).toBeGreaterThan(0);
    });

    it('[T043] should fail with missing to', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
      });
      const errors = await validate(dto);
      const toErrors = errors.filter((e) => e.property === 'to');
      expect(toErrors.length).toBeGreaterThan(0);
    });
  });

  describe('roomId', () => {
    it('[T043] should fail with invalid UUID', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        roomId: 'abc',
      });
      const errors = await validate(dto);
      const roomErrors = errors.filter((e) => e.property === 'roomId');
      expect(roomErrors.length).toBeGreaterThan(0);
    });
  });

  describe('q param', () => {
    it('[T043] should fail with q > 200 chars', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        q: 'a'.repeat(201),
      });
      const errors = await validate(dto);
      const qErrors = errors.filter((e) => e.property === 'q');
      expect(qErrors.length).toBeGreaterThan(0);
    });
  });

  describe('timezone', () => {
    it('[T043] should fail with invalid IANA timezone', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        timezone: 'ABC',
      });
      const errors = await validate(dto);
      const tzErrors = errors.filter((e) => e.property === 'timezone');
      expect(tzErrors.length).toBeGreaterThan(0);
    });

    it('[T043] should default timezone to Asia/Ho_Chi_Minh when not provided', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
      });
      expect(dto.timezone).toBe('Asia/Ho_Chi_Minh');
    });
  });

  describe('role filter', () => {
    it('[T043] should fail with invalid role value', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        role: 'viewer',
      });
      const errors = await validate(dto);
      const roleErrors = errors.filter((e) => e.property === 'role');
      expect(roleErrors.length).toBeGreaterThan(0);
    });

    it('[T043] should accept valid role values', async () => {
      const dto = plainToInstance(MyScheduleQueryDto, {
        view: 'week',
        from: '2026-06-08T00:00:00.000Z',
        to: '2026-06-15T00:00:00.000Z',
        role: 'host',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
