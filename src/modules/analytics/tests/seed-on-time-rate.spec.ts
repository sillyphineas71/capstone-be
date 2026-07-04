import { seedAnalyticsAttendanceReadPermission } from '../../../database/seeds/20260702060000-SeedAnalyticsAttendanceReadPermission';
import { SeedAnalyticsAttendanceReadPermission20260702060000 } from '../../../database/migrations/20260702060000-SeedAnalyticsAttendanceReadPermission';

describe('SeedAnalyticsAttendanceReadPermission', () => {
  let mockQueryRunner: any;
  let mockDataSource: any;

  beforeEach(() => {
    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };
  });

  describe('seed function', () => {
    it('seeds permission and maps to roles', async () => {
      // Return permission ID on INSERT, then role IDs
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }]) // INSERT permission
        .mockResolvedValueOnce([{ id: 'role-1' }]) // SELECT MANAGER
        .mockResolvedValueOnce(undefined) // INSERT role_permission MANAGER
        .mockResolvedValueOnce([{ id: 'role-2' }]) // SELECT BUSINESS_ADMIN
        .mockResolvedValueOnce(undefined) // INSERT role_permission BUSINESS_ADMIN
        .mockResolvedValueOnce([{ id: 'role-3' }]) // SELECT SYSTEM_ADMIN
        .mockResolvedValueOnce(undefined); // INSERT role_permission SYSTEM_ADMIN

      await expect(seedAnalyticsAttendanceReadPermission(mockDataSource)).resolves.toBeUndefined();

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      const permCalls = mockQueryRunner.query.mock.calls;
      expect(permCalls[0][1]).toContain('analytics.attendance.read');
    });

    it('rolls back on error', async () => {
      mockQueryRunner.query.mockRejectedValue(new Error('DB Error'));

      await expect(seedAnalyticsAttendanceReadPermission(mockDataSource)).rejects.toThrow('DB Error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('migration class', () => {
    let migration: SeedAnalyticsAttendanceReadPermission20260702060000;

    beforeEach(() => {
      migration = new SeedAnalyticsAttendanceReadPermission20260702060000();
    });

    it('up inserts permissions and role_permissions', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }]) // INSERT
        .mockResolvedValue(undefined); // role permissions INSERTS

      await expect(migration.up(mockQueryRunner)).resolves.toBeUndefined();
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO permissions'),
        expect.any(Array),
      );
    });

    it('down deletes permissions and role_permissions', async () => {
      mockQueryRunner.query.mockResolvedValue(undefined);

      await expect(migration.down(mockQueryRunner)).resolves.toBeUndefined();
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        expect.any(Array),
      );
    });
  });
});
