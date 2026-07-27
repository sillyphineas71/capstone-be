/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { NotFoundException } from '@nestjs/common';
import { GateAccessHistoryService } from './gate-access-history.service.js';

describe('GateAccessHistoryService (GAH-001 / UC-117)', () => {
  let service: GateAccessHistoryService;
  let query: jest.Mock;
  let dataSource: any;

  const completedRow = {
    id: 'in1',
    zone_id: 'z1',
    zone_code: 'GATE-A',
    zone_name: 'Cổng A',
    user_id: 'u1',
    plate_number: '30A12345',
    metadata_json: { imageUrl: 'https://example.com/img.jpg' },
    check_in_time: new Date('2026-07-23T08:00:00Z'),
    check_out_time: new Date('2026-07-23T17:00:00Z'),
    duration_seconds: 32400,
    session_status: 'completed',
  };

  beforeEach(() => {
    query = jest.fn();
    dataSource = { manager: { query } };
    service = new GateAccessHistoryService(dataSource);
  });

  describe('listForUser', () => {
    it('1 phiên hoàn tất (in+out đã ghép) → CHỈ 1 item, có cả check_in_time và check_out_time', async () => {
      query
        .mockResolvedValueOnce([{ total: 1 }]) // COUNT
        .mockResolvedValueOnce([completedRow]); // SELECT

      const r = await service.listForUser('u1', {
        page: 1,
        limit: 20,
      });

      expect(r.items).toHaveLength(1);
      expect(r.items[0].check_in_time).toEqual(completedRow.check_in_time);
      expect(r.items[0].check_out_time).toEqual(completedRow.check_out_time);
      expect(r.items[0].session_status).toBe('completed');
      expect(r.items[0].user_id).toBeUndefined(); // own route KHÔNG có user_id
      expect((r.items[0] as any).image_url).toBeUndefined(); // list KHÔNG có image_url
    });

    it('SESSION_FILTER (trong CTE) và user_id filter LUÔN có trong query', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listForUser('u1', { page: 1, limit: 20 });

      const countSql = query.mock.calls[0][0] as string;
      const countParams = query.mock.calls[0][1] as unknown[];
      expect(countSql).toContain(
        `(l.direction = 'enter' OR l.paired_log_id IS NULL)`,
      );
      expect(countSql).toContain('sessions.user_id = $1');
      expect(countParams[0]).toBe('u1');
    });

    it('case EX1 (chỉ in, chưa ghép) → check_in_time có, check_out_time null, incomplete', async () => {
      const row = {
        ...completedRow,
        check_out_time: null,
        duration_seconds: null,
        session_status: 'incomplete',
      };
      query.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([row]);
      const r = await service.listForUser('u1', { page: 1, limit: 20 });
      expect(r.items[0].check_in_time).not.toBeNull();
      expect(r.items[0].check_out_time).toBeNull();
      expect(r.items[0].session_status).toBe('incomplete');
    });

    it('case EX2 (chỉ out, chưa ghép) → check_in_time null, check_out_time có, incomplete', async () => {
      const row = {
        ...completedRow,
        check_in_time: null,
        duration_seconds: null,
        session_status: 'incomplete',
      };
      query.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([row]);
      const r = await service.listForUser('u1', { page: 1, limit: 20 });
      expect(r.items[0].check_in_time).toBeNull();
      expect(r.items[0].check_out_time).not.toBeNull();
      expect(r.items[0].session_status).toBe('incomplete');
    });

    it('filter from/to/zoneId áp dụng đúng khi có', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listForUser('u1', {
        page: 1,
        limit: 20,
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
        zoneId: 'z1',
      });
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain('sessions.access_time >= $2');
      expect(sql).toContain('sessions.access_time <= $3');
      expect(sql).toContain('sessions.zone_id = $4');
    });

    it('JOIN zone LUÔN kèm z.deleted_at IS NULL', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listForUser('u1', { page: 1, limit: 20 });
      const selectSql = query.mock.calls[1][0] as string;
      expect(selectSql).toContain('z.deleted_at IS NULL');
    });
  });

  describe('listAll', () => {
    it('departmentId → JOIN users được dùng', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listAll({
        page: 1,
        limit: 20,
        departmentId: 'd1',
      });
      const countSql = query.mock.calls[0][0] as string;
      expect(countSql).toContain(
        'LEFT JOIN users u ON u.id = sessions.user_id',
      );
      expect(countSql).toContain('u.department_id = $1');
    });

    it('KHÔNG departmentId → KHÔNG JOIN users', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listAll({ page: 1, limit: 20 });
      const countSql = query.mock.calls[0][0] as string;
      expect(countSql).not.toContain('LEFT JOIN users');
    });

    it('output CÓ user_id (khác listForUser)', async () => {
      query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([completedRow]);
      const r = await service.listAll({ page: 1, limit: 20 });
      expect(r.items[0].user_id).toBe('u1');
    });

    it('filter userId áp dụng khi có', async () => {
      query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await service.listAll({ page: 1, limit: 20, userId: 'u9' });
      const countSql = query.mock.calls[0][0] as string;
      const countParams = query.mock.calls[0][1] as unknown[];
      expect(countSql).toContain('sessions.user_id = $1');
      expect(countParams[0]).toBe('u9');
    });
  });

  describe('getDetailForUser', () => {
    it('không tồn tại/không thuộc mình → 404 GATE_ACCESS_LOG_NOT_FOUND', async () => {
      query.mockResolvedValue([]);
      await expect(
        service.getDetailForUser('in1', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      try {
        await service.getDetailForUser('in1', 'u1');
      } catch (e: any) {
        expect(e.response.code).toBe('GATE_ACCESS_LOG_NOT_FOUND');
      }
    });

    it('thuộc mình → trả detail CÓ image_url, KHÔNG có user_id', async () => {
      query.mockResolvedValueOnce([completedRow]);
      const r = await service.getDetailForUser('in1', 'u1');
      expect(r.image_url).toBe('https://example.com/img.jpg');
      expect(r.user_id).toBeUndefined();
    });

    it('ownership fold vào WHERE (id = $1 AND user_id = $2, trên CTE sessions)', async () => {
      query.mockResolvedValueOnce([completedRow]);
      await service.getDetailForUser('in1', 'u1');
      const sql = query.mock.calls[0][0] as string;
      const params = query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('WHERE id = $1 AND user_id = $2');
      expect(params).toEqual(['in1', 'u1']);
    });
  });

  describe('getDetailAny', () => {
    it('bất kỳ id tồn tại nào → trả được, CÓ user_id', async () => {
      query.mockResolvedValueOnce([completedRow]);
      const r = await service.getDetailAny('in1');
      expect(r.user_id).toBe('u1');
    });

    it('không tồn tại → 404', async () => {
      query.mockResolvedValueOnce([]);
      await expect(service.getDetailAny('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('metadata_json null → image_url null, KHÔNG throw', async () => {
      query.mockResolvedValueOnce([{ ...completedRow, metadata_json: null }]);
      const r = await service.getDetailAny('in1');
      expect(r.image_url).toBeNull();
    });
  });
});
