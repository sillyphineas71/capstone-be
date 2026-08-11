/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { AlertRulesService } from './alert-rules.service.js';

describe('AlertRulesService (ARL-001 / UC-122)', () => {
  let service: AlertRulesService;
  let repo: any;
  let zoneRepo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'r1', ...x })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    // [FIX 2026-08-11] assertValidIntrusionZone() — mặc định KHÔNG có zone nào (test cần
    // zone hợp lệ phải tự mock zoneRepo.findOne trả về zone lobby/corridor/parking).
    zoneRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertRulesService,
        { provide: getRepositoryToken(AlertRuleEntity), useValue: repo },
        { provide: getRepositoryToken(ZoneEntity), useValue: zoneRepo },
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
          {
            alertType: 'crowd',
            zoneId: 'zone-1', // [FIX 2026-08-11] crowd bắt buộc zoneId — xem assertZoneRequired
            channels: ['in_app'],
          } as any,
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
          {
            alertType: 'crowd',
            zoneId: 'zone-1', // [FIX 2026-08-11] crowd bắt buộc zoneId — xem assertZoneRequired
            channels: ['in_app'],
          } as any,
          'admin1',
        ),
      ).rejects.toBe(boom);
    });

    describe('assertValidIntrusionZone (fix 2026-08-11, chặn intrusion gắn zone không hợp lệ presence)', () => {
      it('intrusion + zone loại lobby → thành công (regression)', async () => {
        zoneRepo.findOne.mockResolvedValue({ id: 'zone-1', zoneType: 'lobby' });
        const r = await service.create(
          { alertType: 'intrusion', zoneId: 'zone-1', channels: ['in_app'] } as any,
          'admin1',
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r.id).toBe('r1');
      });

      it('intrusion + zone loại room → 400 ALERT_RULE_ZONE_WRONG_TYPE, KHÔNG save', async () => {
        zoneRepo.findOne.mockResolvedValue({ id: 'zone-1', zoneType: 'room' });
        await expect(
          service.create(
            { alertType: 'intrusion', zoneId: 'zone-1', channels: ['in_app'] } as any,
            'admin1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_WRONG_TYPE' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('intrusion + zoneId không tồn tại → 400 ALERT_RULE_ZONE_NOT_FOUND, KHÔNG save', async () => {
        zoneRepo.findOne.mockResolvedValue(null);
        await expect(
          service.create(
            { alertType: 'intrusion', zoneId: 'zone-missing', channels: ['in_app'] } as any,
            'admin1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_NOT_FOUND' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      // [FIX 2026-08-11] intrusion + zoneId=null giờ bị assertZoneRequired() chặn TRƯỚC —
      // xem describe 'assertZoneRequired' bên dưới cho hành vi ĐẦY ĐỦ (400
      // ALERT_RULE_ZONE_REQUIRED, KHÔNG còn thành công như bản cũ).
      it('intrusion + zoneId=null → 400 ALERT_RULE_ZONE_REQUIRED (assertZoneRequired chặn TRƯỚC assertValidIntrusionZone), KHÔNG query zones', async () => {
        await expect(
          service.create(
            { alertType: 'intrusion', channels: ['in_app'] } as any,
            'admin1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_REQUIRED' },
        });
        expect(zoneRepo.findOne).not.toHaveBeenCalled();
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('loại KHÁC (crowd, CÓ zoneId) + zone loại room → thành công, KHÔNG bị chặn bởi assertValidIntrusionZone, KHÔNG query zones (regression: kiểm zone-type chỉ áp cho intrusion)', async () => {
        const r = await service.create(
          { alertType: 'crowd', zoneId: 'zone-1', channels: ['in_app'] } as any,
          'admin1',
        );
        expect(zoneRepo.findOne).not.toHaveBeenCalled();
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r.id).toBe('r1');
      });

      it('loại KHÁC (stranger) + zoneId có giá trị → thành công, KHÔNG query zones', async () => {
        await service.create(
          { alertType: 'stranger', zoneId: 'zone-1', channels: ['in_app'] } as any,
          'admin1',
        );
        expect(zoneRepo.findOne).not.toHaveBeenCalled();
      });
    });

    describe('assertZoneRequired (fix 2026-08-11, chặn intrusion/crowd không gắn zoneId — bẫy cấu hình im lặng UC-122 residual)', () => {
      it('intrusion + zoneId=null → 400 ALERT_RULE_ZONE_REQUIRED, KHÔNG save', async () => {
        await expect(
          service.create(
            { alertType: 'intrusion', channels: ['in_app'] } as any,
            'admin1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_REQUIRED' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('crowd + zoneId=null → 400 ALERT_RULE_ZONE_REQUIRED, KHÔNG save', async () => {
        await expect(
          service.create(
            { alertType: 'crowd', channels: ['in_app'] } as any,
            'admin1',
          ),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_REQUIRED' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('intrusion + zoneId hợp lệ (zone loại lobby) → thành công như cũ (regression)', async () => {
        zoneRepo.findOne.mockResolvedValue({ id: 'zone-1', zoneType: 'lobby' });
        const r = await service.create(
          { alertType: 'intrusion', zoneId: 'zone-1', channels: ['in_app'] } as any,
          'admin1',
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r.id).toBe('r1');
      });

      it('person_watchlist_match + zoneId=null → thành công, KHÔNG bị chặn (regression — tính năng phụ thuộc SỐNG CÒN vào zoneId=null, xem PersonWatchlistCheckService)', async () => {
        const r = await service.create(
          { alertType: 'person_watchlist_match', channels: ['in_app'] } as any,
          'admin1',
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r.id).toBe('r1');
      });

      it.each([
        'stranger',
        'vehicle_control_match',
        'unknown_vehicle',
        'vehicle_unauthorized',
      ])(
        '%s + zoneId=null → thành công, KHÔNG bị chặn (regression, dùng findEffectiveRule() có fallback đúng)',
        async (alertType) => {
          const r = await service.create(
            { alertType, channels: ['in_app'] } as any,
            'admin1',
          );
          expect(repo.save).toHaveBeenCalledTimes(1);
          expect(r.id).toBe('r1');
        },
      );
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

    describe('assertValidIntrusionZone (fix 2026-08-11)', () => {
      it('đổi zoneId sang zone loại room trong khi alertType vẫn intrusion → 400 ALERT_RULE_ZONE_WRONG_TYPE, KHÔNG save', async () => {
        repo.findOne
          .mockResolvedValueOnce({ ...owned(), alertType: 'intrusion' }) // load entity
          .mockResolvedValueOnce(null); // assertNoConflict: không trùng
        zoneRepo.findOne.mockResolvedValue({ id: 'zone-2', zoneType: 'room' });
        await expect(
          service.update('r1', { zoneId: 'zone-2' }, 'admin1'),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_WRONG_TYPE' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('đổi trường KHÁC (không đụng zoneId/alertType) → zoneOrTypeChanged=false, KHÔNG gọi lại helper (zoneRepo.findOne không được gọi)', async () => {
        repo.findOne.mockResolvedValueOnce({ ...owned(), alertType: 'intrusion' });
        await service.update('r1', { threshold: 30 }, 'admin1');
        expect(zoneRepo.findOne).not.toHaveBeenCalled();
        expect(repo.save).toHaveBeenCalledTimes(1);
      });
    });

    describe('assertZoneRequired (fix 2026-08-11, chặn intrusion/crowd không gắn zoneId)', () => {
      it('rule intrusion đã có zone, đổi zoneId thành null → 400 ALERT_RULE_ZONE_REQUIRED, KHÔNG save', async () => {
        repo.findOne.mockResolvedValueOnce({
          ...owned(),
          alertType: 'intrusion',
          zoneId: 'zone-1',
        }); // load entity — CHỈ 1 lần, assertZoneRequired chặn TRƯỚC assertNoConflict
        await expect(
          service.update('r1', { zoneId: null }, 'admin1'),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_REQUIRED' },
        });
        expect(repo.save).not.toHaveBeenCalled();
        expect(repo.findOne).toHaveBeenCalledTimes(1); // KHÔNG tới assertNoConflict (query lần 2)
      });

      it('rule crowd đã có zone, đổi zoneId thành null → 400 ALERT_RULE_ZONE_REQUIRED, KHÔNG save', async () => {
        repo.findOne.mockResolvedValueOnce({
          ...owned(),
          alertType: 'crowd',
          zoneId: 'zone-1',
        });
        await expect(
          service.update('r1', { zoneId: null }, 'admin1'),
        ).rejects.toMatchObject({
          response: { code: 'ALERT_RULE_ZONE_REQUIRED' },
        });
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('đổi field KHÁC (threshold, không đụng zoneId/alertType) → zoneOrTypeChanged=false, KHÔNG bị assertZoneRequired chặn dù rule là intrusion', async () => {
        repo.findOne.mockResolvedValueOnce({
          ...owned(),
          alertType: 'intrusion',
          zoneId: 'zone-1',
        });
        const r = await service.update('r1', { threshold: 30 }, 'admin1');
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r).toBeDefined();
      });

      it('đổi alertType sang person_watchlist_match VÀ zoneId thành null trong cùng lúc → thành công (regression, KHÔNG bị chặn nhầm)', async () => {
        repo.findOne
          .mockResolvedValueOnce({
            ...owned(),
            alertType: 'crowd',
            zoneId: 'zone-1',
          }) // load entity
          .mockResolvedValueOnce(null); // assertNoConflict: không trùng
        const r = await service.update(
          'r1',
          { alertType: 'person_watchlist_match', zoneId: null },
          'admin1',
        );
        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(r).toBeDefined();
      });
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
