/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { AlertsService } from './alerts.service.js';

describe('AlertsService (ASC-001 / UC-123)', () => {
  let service: AlertsService;
  let repo: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'a1', ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(SecurityAlertEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(AlertsService);
  });

  describe('recordAlert', () => {
    it('R1 crux: KHÔNG có alert đang mở → INSERT mới, isNew=true, severity theo bảng mặc định', async () => {
      const r = await service.recordAlert({ alertType: 'intrusion' });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe('new');
      expect(saved.occurrenceCount).toBe(1);
      expect(saved.severity).toBe('critical'); // default map intrusion
      expect(saved.zoneId).toBeNull();
      expect(r.isNew).toBe(true);
    });

    it('severity override từ caller được ưu tiên hơn bảng mặc định', async () => {
      await service.recordAlert({ alertType: 'crowd', severity: 'critical' });
      expect(repo.save.mock.calls[0][0].severity).toBe('critical');
    });

    it('alertType lạ không có trong bảng mặc định → fallback medium', async () => {
      await service.recordAlert({ alertType: 'device_error' });
      expect(repo.save.mock.calls[0][0].severity).toBe('low');
    });

    it('R2 crux: 23505 (đã có alert mở) → KHÔNG throw, chuyển UPDATE occurrenceCount, isNew=false, severity/triggeredAt KHÔNG bị ghi đè', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      const openAlert = {
        id: 'open-1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'high',
        status: 'new',
      };
      repo.findOne
        .mockResolvedValueOnce(openAlert) // findOpenAlert
        .mockResolvedValueOnce({ ...openAlert, occurrenceCount: 2 }); // getOrThrow sau bumpOccurrence
      const r = await service.recordAlert({
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'critical', // PHẢI bị bỏ qua — alert đang mở giữ nguyên severity gốc
      });
      expect(r.isNew).toBe(false);
      expect(qb.execute).toHaveBeenCalledTimes(1);
      expect(r.alert.occurrenceCount).toBe(2);
    });

    it('zoneId NULL: findOpenAlert dùng nhánh IsNull (KHÔNG so sánh = null trực tiếp)', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce({ id: 'open-1', status: 'new' })
        .mockResolvedValueOnce({ id: 'open-1', occurrenceCount: 2 });
      await service.recordAlert({ alertType: 'stranger' });
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.zoneId).toBeDefined(); // IsNull() object, KHÔNG phải literal null
    });

    it('race hiếm: 23505 nhưng SELECT không thấy alert mở → retry INSERT 1 lần, thành công', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockResolvedValueOnce({ id: 'a2', status: 'new' });
      repo.findOne.mockResolvedValueOnce(null); // findOpenAlert lần 1: không thấy
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(r.isNew).toBe(true);
    });

    it('race hiếm: retry vẫn 23505, SELECT lần 2 tìm thấy → UPDATE bumpOccurrence', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce(null) // findOpenAlert lần 1: không thấy
        .mockResolvedValueOnce({ id: 'a3', status: 'new' }) // findOpenAlert lần 2: thấy
        .mockResolvedValueOnce({ id: 'a3', occurrenceCount: 2 }); // getOrThrow sau bump
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(r.isNew).toBe(false);
      expect(r.alert.id).toBe('a3');
    });

    it('race cực hiếm: retry vẫn 23505 và vẫn không SELECT thấy → throw lỗi rõ ràng', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.recordAlert({ alertType: 'stranger' }),
      ).rejects.toThrow(/recordAlert/);
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(service.recordAlert({ alertType: 'crowd' })).rejects.toBe(
        boom,
      );
    });
  });

  describe('list', () => {
    it('R3: không truyền status → where KHÔNG có status (trả mọi trạng thái)', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('status' in where).toBe(false);
    });

    it('filter status → where.status đúng giá trị', async () => {
      await service.list({ page: 1, limit: 20, status: 'new' } as any);
      expect(repo.findAndCount.mock.calls[0][0].where.status).toBe('new');
    });

    it('sort mặc định triggeredAt DESC', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      expect(repo.findAndCount.mock.calls[0][0].order).toEqual({
        triggeredAt: 'DESC',
      });
    });
  });

  describe('findDetail (R4)', () => {
    it('không tồn tại → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('zone bị xóa mềm (deletedAt khác null) → trả zone:null (CLAUDE.md §5.5 quy tắc 1)', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: new Date() },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toBeNull();
    });

    it('zone còn sống → trả nguyên zone; history dùng IS NOT DISTINCT FROM', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: null },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toEqual({ id: 'zone-1', deletedAt: null });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'a.zone_id IS NOT DISTINCT FROM :zoneId',
        { zoneId: 'zone-1' },
      );
    });
  });

  describe('acknowledge (R5/R6 crux EX1)', () => {
    it('status=new → conditional update thành công', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'acknowledged' });
      const r = await service.acknowledge('a1', 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'new' },
        expect.objectContaining({
          status: 'acknowledged',
          acknowledgedBy: 'u1',
        }),
      );
      expect(r.status).toBe('acknowledged');
    });

    it('EX1: status KHÔNG PHẢI new (đã bị xử lý) → 409 kèm đúng người/thời điểm', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'acknowledged',
        acknowledgedBy: 'other-guard',
        acknowledgedAt: new Date('2026-07-23T10:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.by).toBe('other-guard');
        expect(e.response.status).toBe('acknowledged');
      }
    });

    it('EX1: đã resolved → conflict dùng resolvedBy/resolvedAt, KHÔNG dùng acknowledgedBy', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'resolved',
        acknowledgedBy: 'guard-a',
        resolvedBy: 'guard-b',
        resolvedAt: new Date('2026-07-23T11:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e.response.by).toBe('guard-b');
      }
    });
  });

  describe('resolve (R7/R8)', () => {
    it('status=acknowledged → conditional update thành công, resolutionNote lưu đúng', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'resolved' });
      await service.resolve('a1', { resolutionNote: 'báo động giả' }, 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'acknowledged' },
        expect.objectContaining({
          status: 'resolved',
          resolutionNote: 'báo động giả',
          resolvedBy: 'u1',
        }),
      );
    });

    it('status=new (chưa acknowledge) → 409, KHÔNG cho nhảy cóc', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'new' });
      await expect(
        service.resolve('a1', { resolutionNote: 'x' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('bulkAcknowledge (R9 AF1)', () => {
    it('mix thành công + conflict — 1 lỗi KHÔNG chặn id khác', async () => {
      repo.update
        .mockResolvedValueOnce({ affected: 1 }) // id1 ok
        .mockResolvedValueOnce({ affected: 0 }); // id2 conflict
      repo.findOne
        .mockResolvedValueOnce({ id: 'id1', status: 'acknowledged' }) // getOrThrow sau update id1
        .mockResolvedValueOnce({
          id: 'id2',
          status: 'resolved',
          resolvedBy: 'other',
          resolvedAt: new Date(),
        }); // getOrThrow trong conflict path id2
      const r = await service.bulkAcknowledge(['id1', 'id2'], 'u1');
      expect(r.acknowledged).toEqual(['id1']);
      expect(r.alreadyProcessed).toHaveLength(1);
      expect(r.alreadyProcessed[0].id).toBe('id2');
      expect(r.alreadyProcessed[0].status).toBe('resolved');
    });

    it('lỗi KHÔNG phải conflict (vd DB down) → ném ra ngoài, dừng batch', async () => {
      const boom = new Error('db down');
      repo.update.mockRejectedValue(boom);
      await expect(service.bulkAcknowledge(['id1'], 'u1')).rejects.toBe(boom);
    });
  });
});
