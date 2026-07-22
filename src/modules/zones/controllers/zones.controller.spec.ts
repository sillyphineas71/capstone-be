/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import { ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ZonesController } from './zones.controller.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';

describe('ZonesController (ZNC-001 / UC-90)', () => {
  let controller: ZonesController;
  let service: any;

  const entity = {
    id: 'z1',
    zoneCode: 'GATE-01',
    zoneName: 'Cổng chính',
    zoneType: 'gate',
    building: null,
    floor: null,
    description: null,
    metadataJson: null,
    status: 'active',
    createdAt: new Date('2026-07-22T00:00:00Z'),
    updatedAt: new Date('2026-07-22T00:00:00Z'),
    deletedAt: null,
  };

  const dto = {
    zoneCode: 'GATE-01',
    zoneName: 'Cổng chính',
    zoneType: 'gate',
  } as CreateZoneDto;

  beforeEach(() => {
    service = { create: jest.fn().mockResolvedValue(entity) };
    controller = new ZonesController(service);
  });

  it('POST /zones → service.create(dto) 1 lần + envelope {success,message,data} qua mapper', async () => {
    const r = await controller.create(dto);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(dto);
    expect(r.success).toBe(true);
    expect(r.message).toBe('Zone created successfully');
    expect(r.data).toMatchObject({
      id: 'z1',
      zone_code: 'GATE-01',
      zone_name: 'Cổng chính',
      zone_type: 'gate',
      status: 'active',
    });
    // Mapper KHÔNG lộ deleted_at.
    expect(r.data).not.toHaveProperty('deleted_at');
  });

  it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.create")', () => {
    const guards = Reflect.getMetadata('__guards__', controller.create) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);

    // Thiếu metadata này = endpoint hở im lặng (PermissionsGuard return true).
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
    expect(perms).toEqual(['zones.zone.create']);
  });

  it('route trả HTTP 201 (@HttpCode CREATED)', () => {
    const status = Reflect.getMetadata('__httpCode__', controller.create);
    expect(status).toBe(201);
  });

  it('service ném ConflictException → controller KHÔNG nuốt, lỗi propagate nguyên trạng', async () => {
    const conflict = new ConflictException({
      code: 'ZONE_CODE_EXISTS',
      message: 'Mã khu vực đã tồn tại',
    });
    service.create.mockRejectedValue(conflict);

    await expect(controller.create(dto)).rejects.toBe(conflict);
  });
});
