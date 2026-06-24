/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { VehicleRegistrationService } from './vehicle-registration.service.js';

describe('VehicleRegistrationService (VPR-001 / UC1)', () => {
  let service: VehicleRegistrationService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'veh1', ...x })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleRegistrationService,
        {
          provide: getRepositoryToken(VehicleRegistrationEntity),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(VehicleRegistrationService);
  });

  it('ok → save với plate_number chuẩn + status active + userId', async () => {
    const r = await service.register('u1', {
      plateRaw: '30A-123.45',
      vehicleType: 'car',
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.plateNumber).toBe('30A12345');
    expect(saved.plateRaw).toBe('30A-123.45');
    expect(saved.status).toBe('active');
    expect(saved.userId).toBe('u1');
    expect(r.id).toBe('veh1');
  });

  it('pre-check trùng (findOne trả row) → ConflictException PLATE_ALREADY_REGISTERED, KHÔNG save', async () => {
    repo.findOne.mockResolvedValue({ id: 'old' });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({
      response: { code: 'PLATE_ALREADY_REGISTERED' },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('SEC: message conflict KHÔNG chứa thông tin user khác', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', userId: 'other-user-999' });
    try {
      await service.register('u1', { plateRaw: '30A12345' });
      fail('should throw');
    } catch (e: any) {
      expect(JSON.stringify(e.response)).not.toContain('other-user-999');
      expect(e).toBeInstanceOf(ConflictException);
    }
  });

  it('save ném 23505 (race) → safety-net ConflictException, KHÔNG ném lỗi thô', async () => {
    repo.save.mockRejectedValue({ driverError: { code: '23505' } });
    await expect(
      service.register('u1', { plateRaw: '30A12345' }),
    ).rejects.toMatchObject({ response: { code: 'PLATE_ALREADY_REGISTERED' } });
  });

  it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
    const boom = new Error('db down');
    repo.save.mockRejectedValue(boom);
    await expect(service.register('u1', { plateRaw: '30A12345' })).rejects.toBe(
      boom,
    );
  });

  describe('format validate (OQ-4) → BadRequestException INVALID_PLATE, KHÔNG save', () => {
    const bad: Array<[string, string]> = [
      ['quá ngắn (5)', '30A12'],
      ['quá dài (11)', '30A12345678'],
      ['toàn chữ', 'ABCDEF'],
      ['toàn số', '123456'],
    ];
    it.each(bad)('%s', async (_label, plateRaw) => {
      await expect(service.register('u1', { plateRaw })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('biên hợp lệ: dài 6 và 10 (có cả chữ+số) → save', async () => {
    await service.register('u1', { plateRaw: '12345A' }); // 6
    await service.register('u1', {
      plateRaw: '99MD123456'.slice(0, 10),
    }); // 10
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  // ── UC2 (VPM-001): sửa / disable / xóa-mềm — ownership ──
  describe('UC2 ownership + sửa/status/xóa', () => {
    const owned = () => ({
      id: 'veh1',
      userId: 'u1',
      plateNumber: '30A12345',
      plateRaw: '30A-123.45',
      vehicleType: 'car',
      note: 'old',
      status: 'active',
    });

    // CRUX: lookup luôn kèm userId + deletedAt IsNull → fold ownership.
    it('loadOwned query lọc {id, userId, deletedAt:IsNull} (đi qua updateMetadata)', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.updateMetadata('veh1', 'u1', { note: 'x' });
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.id).toBe('veh1');
      expect(where.userId).toBe('u1');
      expect(where.deletedAt).toBeDefined(); // IsNull()
    });

    describe('OWNERSHIP: user A đụng biển user B → 404, KHÔNG mutate', () => {
      beforeEach(() => repo.findOne.mockResolvedValue(null)); // không khớp userId

      it('updateMetadata → 404, KHÔNG save', async () => {
        await expect(
          service.updateMetadata('veh1', 'attacker', { note: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.save).not.toHaveBeenCalled();
      });
      it('setStatus → 404, KHÔNG save', async () => {
        await expect(
          service.setStatus('veh1', 'attacker', 'disabled'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.save).not.toHaveBeenCalled();
      });
      it('softDeleteOwned → 404, KHÔNG softDelete', async () => {
        await expect(
          service.softDeleteOwned('veh1', 'attacker'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repo.softDelete).not.toHaveBeenCalled();
      });
      it('404 code=VEHICLE_NOT_FOUND, message trung tính (KHÔNG lộ tồn tại/owner)', async () => {
        try {
          await service.updateMetadata('veh1', 'attacker', { note: 'x' });
          fail('should throw');
        } catch (e: any) {
          expect(e.response.code).toBe('VEHICLE_NOT_FOUND');
          expect(JSON.stringify(e.response)).not.toContain('u1');
        }
      });
    });

    it('biển đã xóa-mềm (findOne null) → softDeleteOwned 404, KHÔNG xóa 2 lần', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.softDeleteOwned('veh1', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('updateMetadata: đổi note + vehicle_type, KHÔNG đụng plateNumber/userId/status', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', {
        note: 'new',
        vehicleType: 'truck',
      });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.note).toBe('new');
      expect(saved.vehicleType).toBe('truck');
      expect(saved.plateNumber).toBe('30A12345'); // nguyên
      expect(saved.userId).toBe('u1');
      expect(saved.status).toBe('active');
    });

    it('undefined: KHÔNG gửi note → giữ nguyên', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', { vehicleType: 'truck' });
      expect(repo.save.mock.calls[0][0].note).toBe('old'); // giữ
    });

    it('null: gửi note=null → set null (xóa note)', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      await service.updateMetadata('veh1', 'u1', { note: null });
      expect(repo.save.mock.calls[0][0].note).toBeNull();
    });

    it('rỗng: cả note+vehicle_type absent → no-op, KHÔNG save, trả nguyên trạng', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      const r = await service.updateMetadata('veh1', 'u1', {});
      expect(repo.save).not.toHaveBeenCalled();
      expect(r).toBe(e);
    });

    it('setStatus: active & disabled → save status mới', async () => {
      repo.findOne.mockResolvedValue(owned());
      await service.setStatus('veh1', 'u1', 'disabled');
      expect(repo.save.mock.calls[0][0].status).toBe('disabled');
      repo.findOne.mockResolvedValue(owned());
      await service.setStatus('veh1', 'u1', 'active');
      expect(repo.save.mock.calls[1][0].status).toBe('active');
    });

    it('softDeleteOwned: loadOwned ok → repo.softDelete(id)', async () => {
      repo.findOne.mockResolvedValue(owned());
      repo.softDelete = jest.fn().mockResolvedValue({ affected: 1 });
      await service.softDeleteOwned('veh1', 'u1');
      expect(repo.softDelete).toHaveBeenCalledWith('veh1');
    });
  });

  // ── UC3 (VPL-001): list + getDetail ──
  describe('UC3 list + getDetail', () => {
    const owned = () => ({ id: 'veh1', userId: 'u1', plateNumber: '30A12345' });
    const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

    it('SEC (BẮT BUỘC): findAndCount where lọc cứng userId=current + deletedAt:IsNull', async () => {
      repo.findAndCount.mockResolvedValue([[owned()], 1]);
      await service.list('u1', q());
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.where.userId).toBe('u1');
      expect(arg.where.deletedAt).toBeDefined(); // IsNull()
      expect(arg.order).toEqual({ createdAt: 'DESC' }); // OQ-5
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      const rows = Array.from({ length: 20 }, () => owned());
      repo.findAndCount.mockResolvedValue([rows, 25]);
      const r = await service.list('u1', q({ page: 1, limit: 20 }));
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
      expect(r.items).toHaveLength(20);
    });

    it('pagination: page=2 limit=20 → skip=20, take=20', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ page: 2, limit: 20 }));
      const arg = repo.findAndCount.mock.calls[0][0];
      expect(arg.skip).toBe(20);
      expect(arg.take).toBe(20);
    });

    it('filter status set → where.status; không set → where KHÔNG có khóa status', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.list('u1', q({ status: 'disabled' }));
      expect(repo.findAndCount.mock.calls[0][0].where.status).toBe('disabled');

      repo.findAndCount.mockClear();
      await service.list('u1', q());
      expect('status' in repo.findAndCount.mock.calls[0][0].where).toBe(false);
    });

    it('list rỗng: findAndCount [[],0] → items:[], meta.total=0, totalPages=0 (KHÔNG throw)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      const r = await service.list('u1', q());
      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    it('getDetail: tái dùng loadOwned → biển của mình → trả entity', async () => {
      const e = owned();
      repo.findOne.mockResolvedValue(e);
      expect(await service.getDetail('veh1', 'u1')).toBe(e);
      // chứng minh đi qua loadOwned (findOne where id+userId+deletedAt).
      expect(repo.findOne.mock.calls[0][0].where).toMatchObject({
        id: 'veh1',
        userId: 'u1',
      });
    });

    it('getDetail: biển người khác/không tồn tại (findOne null) → 404 VEHICLE_NOT_FOUND', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.getDetail('veh1', 'attacker'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
