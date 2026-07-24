/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import { AlertRulesService } from './alert-rules.service.js';

describe('AlertRulesService (ARL-001 / UC-122)', () => {
  let service: AlertRulesService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'r1', ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertRulesService,
        { provide: getRepositoryToken(AlertRuleEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(AlertRulesService);
  });

  describe('create', () => {
    it('zoneId có giá trị: pre-check theo (alertType, zoneId), thành công → save đúng field, createdBy/updatedBy từ actor', async () => {
      const r = await service.create(
        {
          alertType: 'crowd',
          zoneId: 'zone-1',
          threshold: 25,
          channels: ['in_app'],
        } as any,
        'admin1',
      );
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.alertType).toBe('crowd');
      expect(saved.zoneId).toBe('zone-1');
      expect(saved.threshold).toBe(25);
      expect(saved.enabled).toBe(true);
      expect(saved.createdBy).toBe('admin1');
      expect(saved.updatedBy).toBe('admin1');
      expect(r.id).toBe('r1');
    });

    it('zoneId omitted → lưu null (rule mặc định toàn khuôn viên)', async () => {
      await service.create(
        { alertType: 'stranger', channels: ['in_app'] } as any,
        'admin1',
      );
      expect(repo.save.mock.calls[0][0].zoneId).toBeNull();
    });

    it('R1: trùng (alertType, zoneId) còn sống (zone-scoped) → 409, KHÔNG save', async () => {
      repo.findOne.mockResolvedValue({ id: 'old' });
      await expect(
        service.create(
          { alertType: 'crowd', zoneId: 'zone-1', channels: ['in_app'] } as any,
          'admin1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'ALERT_RULE_ALREADY_EXISTS' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('R2: trùng rule mặc định (zoneId NULL) còn sống → 409', async () => {
      repo.findOne.mockResolvedValue({ id: 'old' });
      await expect(
        service.create(
          { alertType: 'stranger', channels: ['in_app'] } as any,
          'admin1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'ALERT_RULE_ALREADY_EXISTS' },
      });
    });

    it('pre-check zone-scoped dùng where.zoneId = giá trị thật (KHÔNG IsNull)', async () => {
      await service.create(
        { alertType: 'crowd', zoneId: 'zone-1', channels: ['in_app'] } as any,
        'admin1',
      );
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.alertType).toBe('crowd');
      expect(where.zoneId).toBe('zone-1');
    });

    it('R3 (crux): save ném 23505 (race) → safety-net 409, KHÔNG ném lỗi thô', async () => {
      repo.save.mockRejectedValue({ driverError: { code: '23505' } });
      await expect(
        service.create(
          { alertType: 'crowd', channels: ['in_app'] } as any,
          'admin1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'ALERT_RULE_ALREADY_EXISTS' },
      });
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(
        service.create(
          { alertType: 'crowd', channels: ['in_app'] } as any,
          'admin1',
        ),
      ).rejects.toBe(boom);
    });
  });

  describe('list', () => {
    const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

    it('không filter → where CHỈ deletedAt:IsNull', async () => {
      await service.list(q());
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(where.deletedAt).toBeDefined();
      expect('alertType' in where).toBe(false);
      expect('zoneId' in where).toBe(false);
      expect('enabled' in where).toBe(false);
    });

    it('CRUX: filter enabled=false PHẢI được áp dụng', async () => {
      await service.list(q({ enabled: false }));
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('enabled' in where).toBe(true);
      expect(where.enabled).toBe(false);
    });

    it('order + phân trang đúng, sortOrder desc mặc định', async () => {
      await service.list(q({ page: 2, limit: 10 }));
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.order).toEqual({ createdAt: 'DESC' });
      expect(arg.skip).toBe(10);
      expect(arg.take).toBe(10);
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      const rows = Array.from({ length: 20 }, () => ({ id: 'x' }));
      repo.findAndCount.mockResolvedValue([rows, 25]);
      const r = await service.list(q({ page: 1, limit: 20 }));
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
    });
  });

  describe('findOne', () => {
    it('tồn tại → trả entity', async () => {
      const e = { id: 'r1' };
      repo.findOne.mockResolvedValue(e);
      expect(await service.findOne('r1')).toBe(e);
    });

    it('không tồn tại → 404 ALERT_RULE_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const owned = () => ({
      id: 'r1',
      alertType: 'crowd',
      zoneId: 'zone-1',
      threshold: 25,
      channels: ['in_app'],
      enabled: true,
      restrictedHoursJson: null,
      allowedPersonIdsJson: null,
    });

    it('không tồn tại → 404, KHÔNG save', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', {}, 'admin1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('đổi threshold/enabled — KHÔNG đổi alertType/zoneId → KHÔNG re-check conflict', async () => {
      repo.findOne.mockResolvedValueOnce(owned());
      await service.update('r1', { threshold: 30, enabled: false }, 'admin1');
      // findOne chỉ được gọi 1 lần (load entity), KHÔNG có lần 2 (pre-check conflict).
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.threshold).toBe(30);
      expect(saved.enabled).toBe(false);
      expect(saved.updatedBy).toBe('admin1');
    });

    it('đổi zoneId → re-check conflict (loại trừ chính id)', async () => {
      repo.findOne
        .mockResolvedValueOnce(owned()) // load entity
        .mockResolvedValueOnce(null); // pre-check conflict: không trùng
      await service.update('r1', { zoneId: 'zone-2' }, 'admin1');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
      const conflictWhere = repo.findOne.mock.calls[1][0].where;
      expect(conflictWhere.zoneId).toBe('zone-2');
      expect(conflictWhere.id).toBeDefined(); // Not(excludeId)
    });

    it('đổi zoneId trùng rule khác đang sống → 409, KHÔNG save', async () => {
      repo.findOne
        .mockResolvedValueOnce(owned())
        .mockResolvedValueOnce({ id: 'other-rule' });
      await expect(
        service.update('r1', { zoneId: 'zone-2' }, 'admin1'),
      ).rejects.toMatchObject({
        response: { code: 'ALERT_RULE_ALREADY_EXISTS' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('tồn tại → softDelete sau khi set updatedBy', async () => {
      repo.findOne.mockResolvedValue({ id: 'r1' });
      await service.remove('r1', 'admin1');
      expect(repo.update).toHaveBeenCalledWith('r1', { updatedBy: 'admin1' });
      expect(repo.softDelete).toHaveBeenCalledWith('r1');
    });

    it('không tồn tại → 404, KHÔNG softDelete', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('missing', 'admin1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('findActiveRule (R8 BR2 override)', () => {
    it('có cả rule riêng zone lẫn rule mặc định cùng enabled=true → trả rule riêng zone', async () => {
      const zoned = { id: 'zoned', zoneId: 'zone-1' };
      repo.findOne.mockResolvedValueOnce(zoned);
      const r = await service.findActiveRule('crowd', 'zone-1');
      expect(r).toBe(zoned);
      expect(repo.findOne).toHaveBeenCalledTimes(1); // KHÔNG fallback vì đã thấy zone-scoped
    });

    it('chỉ có rule mặc định → trả rule mặc định (fallback)', async () => {
      const global = { id: 'global', zoneId: null };
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(global);
      const r = await service.findActiveRule('crowd', 'zone-1');
      expect(r).toBe(global);
    });

    it('không truyền zoneId → chỉ query rule mặc định', async () => {
      const global = { id: 'global', zoneId: null };
      repo.findOne.mockResolvedValueOnce(global);
      const r = await service.findActiveRule('crowd');
      expect(r).toBe(global);
      expect(repo.findOne).toHaveBeenCalledTimes(1);
    });

    it('R7: rule tồn tại nhưng enabled=false → KHÔNG trả (findOne where enabled:true không match) → null', async () => {
      repo.findOne.mockResolvedValue(null);
      const r = await service.findActiveRule('crowd', 'zone-1');
      expect(r).toBeNull();
    });
  });

  describe('findEffectiveRule (R10 §2.8 fail-open)', () => {
    it('có rule enabled → { rule, suppressed:false }', async () => {
      const enabled = { id: 'e1' };
      repo.findOne.mockResolvedValueOnce(enabled);
      const r = await service.findEffectiveRule('crowd', 'zone-1');
      expect(r).toEqual({ rule: enabled, suppressed: false });
    });

    it('không có rule enabled nhưng có rule disabled zone-scoped → suppressed:true', async () => {
      repo.findOne
        .mockResolvedValueOnce(null) // findActiveRule zone-scoped enabled
        .mockResolvedValueOnce(null) // findActiveRule global enabled
        .mockResolvedValueOnce({ id: 'disabled-zoned' }); // disabled zone-scoped
      const r = await service.findEffectiveRule('crowd', 'zone-1');
      expect(r).toEqual({ rule: null, suppressed: true });
    });

    it('không có rule enabled, không có disabled zone-scoped, có disabled global → suppressed:true', async () => {
      repo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null) // disabled zone-scoped: none
        .mockResolvedValueOnce({ id: 'disabled-global' }); // disabled global
      const r = await service.findEffectiveRule('crowd', 'zone-1');
      expect(r).toEqual({ rule: null, suppressed: true });
    });

    it('chưa từng cấu hình (không rule nào, kể cả disabled) → suppressed:false (fail-open)', async () => {
      repo.findOne.mockResolvedValue(null);
      const r = await service.findEffectiveRule('crowd', 'zone-1');
      expect(r).toEqual({ rule: null, suppressed: false });
    });

    it('gọi KHÔNG truyền zoneId, không rule nào → fail-open, KHÔNG query nhánh zone-scoped disabled', async () => {
      repo.findOne.mockResolvedValue(null);
      const r = await service.findEffectiveRule('stranger');
      expect(r).toEqual({ rule: null, suppressed: false });
      // findActiveRule (1 query, global-only) + disabled global (1 query) = 2 total.
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });
  });
});
