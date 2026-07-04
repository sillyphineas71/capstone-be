import { seedAnalyticsRoomReadPermission } from '../../../database/seeds/20260702070000-SeedAnalyticsRoomReadPermission';
import { SeedAnalyticsRoomReadPermission20260702070000 } from '../../../database/migrations/20260702070000-SeedAnalyticsRoomReadPermission';

describe('SeedAnalyticsRoomReadPermission', () => {
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

      await expect(seedAnalyticsRoomReadPermission(mockDataSource)).resolves.toBeUndefined();

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      const permCalls = mockQueryRunner.query.mock.calls;
      expect(permCalls[0][1]).toContain('analytics.room.read');
    });

    // T5: Verify seed assigns permission to exactly 3 roles: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
    it('T5 – seed assigns analytics.room.read to all 3 required roles', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }]) // INSERT permission
        .mockResolvedValueOnce([{ id: 'role-1' }]) // SELECT MANAGER
        .mockResolvedValueOnce(undefined) // INSERT role_permission MANAGER
        .mockResolvedValueOnce([{ id: 'role-2' }]) // SELECT BUSINESS_ADMIN
        .mockResolvedValueOnce(undefined) // INSERT role_permission BUSINESS_ADMIN
        .mockResolvedValueOnce([{ id: 'role-3' }]) // SELECT SYSTEM_ADMIN
        .mockResolvedValueOnce(undefined); // INSERT role_permission SYSTEM_ADMIN

      await seedAnalyticsRoomReadPermission(mockDataSource);

      const allCalls = mockQueryRunner.query.mock.calls;

      // Verify that each of the 3 required roles was queried
      const roleLookupCalls = allCalls.filter(
        (call: [string, unknown[]]) =>
          typeof call[0] === 'string' &&
          call[0].includes('SELECT id FROM roles WHERE role_code'),
      );
      const queriedRoleCodes = roleLookupCalls.map((call: [string, unknown[]]) => call[1][0]);

      expect(queriedRoleCodes).toContain('MANAGER');
      expect(queriedRoleCodes).toContain('BUSINESS_ADMIN');
      expect(queriedRoleCodes).toContain('SYSTEM_ADMIN');
      expect(queriedRoleCodes).toHaveLength(3);

      // Verify role_permission INSERT was called 3 times (once per role)
      const insertRolePerm = allCalls.filter(
        (call: [string, unknown[]]) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO role_permissions'),
      );
      expect(insertRolePerm).toHaveLength(3);
    });

    it('rolls back on error', async () => {
      mockQueryRunner.query.mockRejectedValue(new Error('DB Error'));

      await expect(seedAnalyticsRoomReadPermission(mockDataSource)).rejects.toThrow('DB Error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('migration class', () => {
    let migration: SeedAnalyticsRoomReadPermission20260702070000;

    beforeEach(() => {
      migration = new SeedAnalyticsRoomReadPermission20260702070000();
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
