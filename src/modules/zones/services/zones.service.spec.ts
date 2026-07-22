/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
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
});
