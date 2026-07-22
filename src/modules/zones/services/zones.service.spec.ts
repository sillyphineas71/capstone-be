/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { ZoneEntity } from '../entities/zone.entity.js';
import { ZonesService } from './zones.service.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';

const dto = (over: Partial<CreateZoneDto> = {}): CreateZoneDto => ({
  zoneCode: 'GATE-01',
  zoneName: 'Cổng chính',
  zoneType: 'gate',
  ...over,
});

describe('ZonesService (ZNC-001 / UC-90)', () => {
  let service: ZonesService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'z1', ...x })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZonesService,
        { provide: getRepositoryToken(ZoneEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(ZonesService);
  });

  // Case 1
  it('happy path → save 1 lần, zone_code chuẩn hóa, optional = null, KHÔNG set status/id/deletedAt', async () => {
    const result = await service.create(dto({ zoneCode: ' gate-01 ' }));

    expect(repo.save).toHaveBeenCalledTimes(1);
    const created = repo.create.mock.calls[0][0];
    expect(created.zoneCode).toBe('GATE-01');
    expect(created.zoneName).toBe('Cổng chính');
    expect(created.zoneType).toBe('gate');
    expect(created.building).toBeNull();
    expect(created.floor).toBeNull();
    expect(created.description).toBeNull();
    expect(created.metadataJson).toBeNull();
    // status/id/timestamps/deletedAt do DB + entity default lo — service KHÔNG đụng.
    expect(created).not.toHaveProperty('status');
    expect(created).not.toHaveProperty('id');
    expect(created).not.toHaveProperty('deletedAt');
    expect(result.id).toBe('z1');
  });

  // Case 2
  it('trùng zone_code đang sống → 409 ZONE_CODE_EXISTS, KHÔNG save', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', zoneCode: 'GATE-01' });

    await expect(service.create(dto())).rejects.toMatchObject({
      response: { code: 'ZONE_CODE_EXISTS' },
    });
    await expect(service.create(dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  // Case 3
  it('race 23505 (pre-check lọt, DB chặn) → 409 ZONE_CODE_EXISTS, không rò driverError/stack', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockRejectedValue(
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          driverError: {
            code: '23505',
            detail: 'Key (zone_code)=(GATE-01) exists.',
          },
        },
      ),
    );

    try {
      await service.create(dto());
      fail('should throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      // Cùng payload với nhánh pre-check (case 2).
      expect(e.response).toMatchObject({
        code: 'ZONE_CODE_EXISTS',
        message: 'Mã khu vực đã tồn tại',
      });
      const serialized = JSON.stringify(e.response);
      expect(serialized).not.toContain('23505');
      expect(serialized).not.toContain('duplicate key');
    }
  });

  // Case 4
  it('lỗi DB khác 23505 (vd 23503) → ném NGUYÊN lỗi, KHÔNG nuốt thành 409', async () => {
    const dbError = Object.assign(new Error('fk violation'), {
      driverError: { code: '23503' },
    });
    repo.save.mockRejectedValue(dbError);

    await expect(service.create(dto())).rejects.toBe(dbError);
    await expect(service.create(dto())).rejects.not.toBeInstanceOf(
      ConflictException,
    );
  });

  // Case 5 — bảo vệ OQ-3
  it('mã của zone đã soft-delete vẫn tạo được: pre-check lọc deletedAt IS NULL', async () => {
    repo.findOne.mockResolvedValue(null); // bản ghi cũ đã xóa-mềm → không lọt vào where

    const result = await service.create(dto({ zoneCode: 'GATE-01' }));

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { zoneCode: 'GATE-01', deletedAt: IsNull() },
    });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('z1');
  });

  // Case 6
  it('chuẩn hóa nhất quán: cùng giá trị dùng cho CẢ pre-check và bản ghi lưu', async () => {
    await service.create(dto({ zoneCode: '  gate-01  ' }));

    expect(repo.findOne.mock.calls[0][0].where.zoneCode).toBe('GATE-01');
    expect(repo.create.mock.calls[0][0].zoneCode).toBe('GATE-01');

    jest.clearAllMocks();
    repo.findOne.mockResolvedValue(null);
    repo.create.mockImplementation((x: any) => x);
    repo.save.mockImplementation((x: any) =>
      Promise.resolve({ id: 'z2', ...x }),
    );

    await service.create(dto({ zoneCode: 'GATE-01' }));
    expect(repo.findOne.mock.calls[0][0].where.zoneCode).toBe('GATE-01');
    expect(repo.create.mock.calls[0][0].zoneCode).toBe('GATE-01');
  });

  it('field optional có giá trị → giữ nguyên (không ép null)', async () => {
    await service.create(
      dto({
        building: 'A',
        floor: 'B1',
        description: 'Cổng phía Đông',
        metadataJson: { lane: 2 },
      }),
    );

    const created = repo.create.mock.calls[0][0];
    expect(created.building).toBe('A');
    expect(created.floor).toBe('B1');
    expect(created.description).toBe('Cổng phía Đông');
    expect(created.metadataJson).toEqual({ lane: 2 });
  });

  // ── UC-91 (ZNU-001): update ──
  describe('update (ZNU-001 / UC-91)', () => {
    const makeZone = (over: Record<string, any> = {}) => ({
      id: 'z1',
      zoneCode: 'GATE-01',
      zoneName: 'Cổng chính',
      zoneType: 'gate',
      status: 'active',
      building: null,
      floor: null,
      description: null,
      metadataJson: null,
      deletedAt: null,
      ...over,
    });

    beforeEach(() => {
      // save mặc định trả về chính entity đã merge (giống TypeORM).
      repo.save = jest.fn((x: any) => Promise.resolve(x));
    });

    // Case 1
    it('happy path: đổi zone_name + building → save 1 lần, field khác giữ nguyên', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', {
        zoneName: 'Cổng chính (mới)',
        building: 'A',
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(r.zoneName).toBe('Cổng chính (mới)');
      expect(r.building).toBe('A');
      expect(r.zoneCode).toBe('GATE-01');
      expect(r.zoneType).toBe('gate');
      expect(r.status).toBe('active');
    });

    // Case 2
    it('404 ZONE_NOT_FOUND khi zone không tồn tại, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('missing', { zoneName: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'ZONE_NOT_FOUND' } });
      expect(repo.save).not.toHaveBeenCalled();
    });

    // Case 3
    it('404 khi zone đã soft-delete: lookup lọc deletedAt IS NULL', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update('z-deleted', { zoneName: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'z-deleted', deletedAt: IsNull() },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    // Case 4
    it('đổi zone_code trùng zone khác → 409 ZONE_CODE_EXISTS, KHÔNG save', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone()) // load
        .mockResolvedValueOnce({ id: 'z2', zoneCode: 'GATE-02' }); // pre-check

      await expect(
        service.update('z1', { zoneCode: 'GATE-02' }),
      ).rejects.toMatchObject({ response: { code: 'ZONE_CODE_EXISTS' } });

      // Pre-check PHẢI loại chính bản ghi đang sửa + lọc soft-delete.
      expect(repo.findOne).toHaveBeenLastCalledWith({
        where: { zoneCode: 'GATE-02', deletedAt: IsNull(), id: Not('z1') },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    // Case 5 — bảo vệ Not(id) + điều kiện "mã thực sự đổi"
    it('gửi lại ĐÚNG zone_code của chính nó → KHÔNG 409, KHÔNG chạy pre-check', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());

      const r = await service.update('z1', { zoneCode: 'gate-01' });

      // Chỉ 1 lần findOne = chỉ có lượt load, pre-check bị bỏ qua.
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled(); // mã sau chuẩn hóa không đổi → no-op
      expect(r.zoneCode).toBe('GATE-01');
    });

    // Case 6
    it('race 23505 → 409 ZONE_CODE_EXISTS, không rò driverError/stack', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone())
        .mockResolvedValueOnce(null);
      repo.save.mockRejectedValue(
        Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { driverError: { code: '23505' } },
        ),
      );

      try {
        await service.update('z1', { zoneCode: 'GATE-09' });
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response).toMatchObject({
          code: 'ZONE_CODE_EXISTS',
          message: 'Mã khu vực đã tồn tại',
        });
        const serialized = JSON.stringify(e.response);
        expect(serialized).not.toContain('23505');
        expect(serialized).not.toContain('duplicate key');
      }
    });

    // Case 7
    it('lỗi DB khác 23505 → ném NGUYÊN lỗi, KHÔNG thành 409', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());
      const dbError = Object.assign(new Error('fk violation'), {
        driverError: { code: '23503' },
      });
      repo.save.mockRejectedValue(dbError);

      await expect(service.update('z1', { zoneName: 'x' })).rejects.toBe(
        dbError,
      );
    });

    // Case 8
    it('no-op: body rỗng → KHÔNG save, trả entity nguyên trạng', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', {});

      expect(repo.save).not.toHaveBeenCalled();
      expect(r).toBe(zone);
    });

    // Case 9 — chứng minh so-sánh-giá-trị-thật (không chỉ dựa vào undefined)
    it('no-op: gửi đúng giá trị đang có → KHÔNG save', async () => {
      const zone = makeZone();
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', {
        zoneName: 'Cổng chính',
        zoneType: 'gate',
        status: 'active',
      });

      expect(repo.save).not.toHaveBeenCalled();
      expect(r).toBe(zone);
    });

    // Case 10
    it('undefined → giữ nguyên field không gửi', async () => {
      const zone = makeZone({
        building: 'A',
        floor: 'B1',
        description: 'desc',
        metadataJson: { lane: 1 },
      });
      repo.findOne.mockResolvedValueOnce(zone);

      const r = await service.update('z1', { zoneName: 'Tên mới' });

      expect(r.zoneName).toBe('Tên mới');
      expect(r.building).toBe('A');
      expect(r.floor).toBe('B1');
      expect(r.description).toBe('desc');
      expect(r.metadataJson).toEqual({ lane: 1 });
      expect(r.zoneType).toBe('gate');
      expect(r.status).toBe('active');
    });

    // Case 11
    it('null → xóa giá trị (set NULL) cho field nullable', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ building: 'A' }));

      const r = await service.update('z1', { building: null });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(r.building).toBeNull();
    });

    // Case 12
    it('chuẩn hóa zone_code: cùng giá trị dùng cho CẢ pre-check và save', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeZone())
        .mockResolvedValueOnce(null);

      const r = await service.update('z1', { zoneCode: '  gate-02  ' });

      expect(repo.findOne.mock.calls[1][0].where.zoneCode).toBe('GATE-02');
      expect(repo.save.mock.calls[0][0].zoneCode).toBe('GATE-02');
      expect(r.zoneCode).toBe('GATE-02');
    });

    // Case 13
    it('metadata_json REPLACE toàn bộ (không merge sâu)', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ metadataJson: { a: 1 } }));

      const r = await service.update('z1', { metadataJson: { b: 2 } });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(r.metadataJson).toEqual({ b: 2 });
      expect(r.metadataJson).not.toHaveProperty('a');
    });

    // Case 14 — OQ-3: status đi chung route update
    it('đổi status active → inactive: save được gọi, field khác giữ nguyên', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone());

      const r = await service.update('z1', { status: 'inactive' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(r.status).toBe('inactive');
      expect(r.zoneCode).toBe('GATE-01');
      expect(r.zoneName).toBe('Cổng chính');
      expect(r.zoneType).toBe('gate');
    });

    // Case 15 — OQ-1: cho phép sửa zone_type
    it('đổi zone_type room → gate: save được gọi, giá trị mới được ghi', async () => {
      repo.findOne.mockResolvedValueOnce(makeZone({ zoneType: 'room' }));

      const r = await service.update('z1', { zoneType: 'gate' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(r.zoneType).toBe('gate');
      expect(r.zoneCode).toBe('GATE-01');
    });
  });
});
