/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ZonesController } from './zones.controller.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';
import type { UpdateZoneDto } from '../dto/update-zone.dto.js';

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
    const r = await controller.create({ userId: 'u1' }, dto);

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith(dto, 'u1');
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

    await expect(controller.create({ userId: 'u1' }, dto)).rejects.toBe(
      conflict,
    );
  });

  // ── UC-91 (ZNU-001): route PATCH /zones/:id ──
  describe('update (ZNU-001 / UC-91)', () => {
    const updateDto = { zoneName: 'Cổng chính (mới)' } as UpdateZoneDto;

    beforeEach(() => {
      service.update = jest
        .fn()
        .mockResolvedValue({ ...entity, zoneName: 'Cổng chính (mới)' });
    });

    it('gọi service.update(id, dto) 1 lần + envelope qua mapper', async () => {
      const r = await controller.update({ userId: 'u1' }, 'z1', updateDto);

      expect(service.update).toHaveBeenCalledTimes(1);
      expect(service.update).toHaveBeenCalledWith('z1', updateDto, 'u1');
      expect(r.success).toBe(true);
      expect(r.message).toBe('Zone updated successfully');
      expect(r.data).toMatchObject({
        id: 'z1',
        zone_code: 'GATE-01',
        zone_name: 'Cổng chính (mới)',
        status: 'active',
      });
      expect(r.data).not.toHaveProperty('deleted_at');
    });

    it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.update")', () => {
      const guards = Reflect.getMetadata('__guards__', controller.update) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);

      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.update);
      expect(perms).toEqual(['zones.zone.update']);
    });

    it('service ném NotFoundException → propagate nguyên trạng', async () => {
      const notFound = new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
      service.update.mockRejectedValue(notFound);

      await expect(
        controller.update({ userId: 'u1' }, 'missing', updateDto),
      ).rejects.toBe(notFound);
    });

    it('service ném ConflictException → propagate nguyên trạng', async () => {
      const conflict = new ConflictException({
        code: 'ZONE_CODE_EXISTS',
        message: 'Mã khu vực đã tồn tại',
      });
      service.update.mockRejectedValue(conflict);

      await expect(
        controller.update({ userId: 'u1' }, 'z1', updateDto),
      ).rejects.toBe(conflict);
    });

    it(':id không phải UUID → ParseUUIDPipe reject (400)', async () => {
      await expect(
        new ParseUUIDPipe().transform('abc', { type: 'param' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── UC-92 (ZND-001): route DELETE /zones/:id ──
  describe('remove (ZND-001 / UC-92)', () => {
    beforeEach(() => {
      service.remove = jest.fn().mockResolvedValue(undefined);
    });

    it('gọi service.remove(id, userId) 1 lần + envelope data:null', async () => {
      const r = await controller.remove({ userId: 'u1' }, 'z1');

      expect(service.remove).toHaveBeenCalledTimes(1);
      expect(service.remove).toHaveBeenCalledWith('z1', 'u1');
      expect(r).toEqual({
        success: true,
        message: 'Zone deleted successfully',
        data: null,
      });
    });

    it('gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions("zones.zone.delete")', () => {
      const guards = Reflect.getMetadata('__guards__', controller.remove) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);

      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.remove);
      expect(perms).toEqual(['zones.zone.delete']);
    });

    it('service ném NotFoundException → propagate nguyên trạng', async () => {
      const notFound = new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
      service.remove.mockRejectedValue(notFound);

      await expect(controller.remove({ userId: 'u1' }, 'missing')).rejects.toBe(
        notFound,
      );
    });

    it('service ném ConflictException ZONE_HAS_DEVICES → propagate nguyên trạng', async () => {
      const conflict = new ConflictException({
        code: 'ZONE_HAS_DEVICES',
        message: 'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá',
      });
      service.remove.mockRejectedValue(conflict);

      await expect(controller.remove({ userId: 'u1' }, 'z1')).rejects.toBe(
        conflict,
      );
    });
  });
});
