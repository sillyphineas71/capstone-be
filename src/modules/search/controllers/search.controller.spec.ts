/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { SearchController } from './search.controller.js';

describe('SearchController (SRCH-01)', () => {
  let controller: SearchController;
  let service: any;

  beforeEach(() => {
    service = {
      search: jest.fn().mockResolvedValue({ query: 'test', types: [] }),
    };
    controller = new SearchController(service);
  });

  it('route CHỈ có JwtAuthGuard — KHÔNG PermissionsGuard (chủ ý spec §1.1, không phải thiếu sót)', () => {
    const guards = Reflect.getMetadata('__guards__', controller.search) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PermissionsGuard);
  });

  it('GET /search không truyền types → gọi service với cả 5 type mặc định', async () => {
    const result = await controller.search({ userId: 'user-1' }, { q: 'test' });
    expect(service.search).toHaveBeenCalledWith('user-1', 'test', [
      'zone',
      'device',
      'vehicle',
      'user',
      'meeting',
    ]);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Search results retrieved successfully');
  });

  it('GET /search với types hợp lệ → parse đúng mảng', async () => {
    await controller.search(
      { userId: 'user-1' },
      { q: 'test', types: 'zone, device' },
    );
    expect(service.search).toHaveBeenCalledWith('user-1', 'test', [
      'zone',
      'device',
    ]);
  });

  it('R3: types chứa giá trị không hợp lệ → BadRequestException, KHÔNG gọi service', async () => {
    await expect(
      controller.search({ userId: 'user-1' }, { q: 'test', types: 'zonee' }),
    ).rejects.toThrow(BadRequestException);
    expect(service.search).not.toHaveBeenCalled();
  });
});
