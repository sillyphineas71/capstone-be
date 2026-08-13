import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
import { MediaFilesController } from './media-files.controller.js';
import { MediaFilesService } from '../services/media-files.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (PROMPT 1): sau khi gỡ MockPermissionsGuard, xác nhận mỗi route
 * gắn đúng guard THẬT (JwtAuthGuard + PermissionsGuard) và đúng permission code.
 * Đọc metadata trực tiếp trên prototype method — không cần dựng DI.
 * Mirror departments.controller.spec.ts (khối "RBAC metadata").
 */
describe('MediaFilesController — RBAC metadata (PROMPT 1)', () => {
  const reflector = new Reflector();

  const cases: Array<[string, string]> = [
    ['list', 'recording.files.read'],
    ['detail', 'recording.files.read'],
    ['playback', 'recording.files.play'],
    ['setVisibility', 'recording.files.manage'],
  ];

  it.each(cases)('%s: @RequirePermissions = %s', (method, code) => {
    const handler = (MediaFilesController.prototype as Record<string, unknown>)[
      method
    ] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual([code]);
  });

  it.each(cases)(
    '%s: gắn guard thật JwtAuthGuard + PermissionsGuard (không còn Mock)',
    (method) => {
      const handler = (
        MediaFilesController.prototype as Record<string, unknown>
      )[method] as (...args: unknown[]) => unknown;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
      );
    },
  );
});

describe('MediaFilesService — ownership check for setVisibility', () => {
  let service: MediaFilesService;
  let repoMock: any;
  let dataSourceMock: any;

  beforeEach(() => {
    repoMock = {
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSourceMock = {
      manager: {
        query: jest.fn(),
      },
    };
    service = new MediaFilesService(
      repoMock,
      {} as any,
      {} as any,
      dataSourceMock,
    );
  });

  it('EMPLOYEE là host của meeting → soft_delete audio của meeting đó → 200/thành công', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'file-1',
      meetingId: 'meeting-1',
      isActive: true,
    });
    dataSourceMock.manager.query
      .mockResolvedValueOnce([{ role_code: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'participant-host-id' }]);

    const res = await service.setVisibility(
      'file-1',
      { action: 'soft_delete' },
      'user-host-id',
    );
    expect(repoMock.softDelete).toHaveBeenCalledWith('file-1');
    expect(res).toMatchObject({ fileId: 'file-1', isActive: true });
  });

  it('EMPLOYEE KHÔNG phải host (participant thường hoặc người ngoài) → 403 PERMISSION_DENIED', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'file-1',
      meetingId: 'meeting-1',
      isActive: true,
    });
    dataSourceMock.manager.query
      .mockResolvedValueOnce([{ role_code: 'EMPLOYEE' }])
      .mockResolvedValueOnce([]); // not host

    let error: any;
    try {
      await service.setVisibility(
        'file-1',
        { action: 'soft_delete' },
        'user-member-id',
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Chỉ Host của meeting mới được xóa audio này.',
    });
  });

  it('EMPLOYEE với meetingId = null → 403 PERMISSION_DENIED', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'file-1',
      meetingId: null,
      isActive: true,
    });
    dataSourceMock.manager.query.mockResolvedValueOnce([
      { role_code: 'EMPLOYEE' },
    ]);

    await expect(
      service.setVisibility(
        'file-1',
        { action: 'soft_delete' },
        'user-employee-id',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'])(
    'Role %s không phải host → vẫn pass nguyên (không làm yếu quyền admin hiện có)',
    async (roleCode) => {
      repoMock.findOne.mockResolvedValue({
        id: 'file-1',
        meetingId: 'meeting-1',
        isActive: true,
      });
      dataSourceMock.manager.query.mockResolvedValueOnce([
        { role_code: roleCode },
      ]);

      const res = await service.setVisibility(
        'file-1',
        { action: 'soft_delete' },
        'user-admin-id',
      );
      expect(repoMock.softDelete).toHaveBeenCalledWith('file-1');
      expect(res).toMatchObject({ fileId: 'file-1' });
    },
  );
});

