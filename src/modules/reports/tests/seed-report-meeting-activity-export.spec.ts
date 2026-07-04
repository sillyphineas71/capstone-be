/**
 * seed-report-meeting-activity-export.spec.ts
 *
 * Unit tests cho seed và migration (T038).
 * Đối chiếu pattern seed-room-usage.spec.ts.
 */

import { seedReportMeetingActivityExportPermission } from '../../../database/seeds/20260703000001-SeedReportMeetingActivityExportPermission.js';
import { SeedReportMeetingActivityExportPermission20260703000001 } from '../../../database/migrations/20260703000001-SeedReportMeetingActivityExportPermission.js';

describe('SeedReportMeetingActivityExportPermission', () => {
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
    it('seeds permission and maps to 3 roles', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }]) // INSERT permission
        .mockResolvedValueOnce([{ id: 'role-1' }]) // SELECT MANAGER
        .mockResolvedValueOnce(undefined)           // INSERT role_permission MANAGER
        .mockResolvedValueOnce([{ id: 'role-2' }]) // SELECT BUSINESS_ADMIN
        .mockResolvedValueOnce(undefined)           // INSERT role_permission BUSINESS_ADMIN
        .mockResolvedValueOnce([{ id: 'role-3' }]) // SELECT SYSTEM_ADMIN
        .mockResolvedValueOnce(undefined);          // INSERT role_permission SYSTEM_ADMIN

      await expect(
        seedReportMeetingActivityExportPermission(mockDataSource),
      ).resolves.toBeUndefined();

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      const permCalls = mockQueryRunner.query.mock.calls;
      expect(permCalls[0][1]).toContain('report.meeting_activity.export');
    });

    it('assigns permission to exactly 3 roles: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }])
        .mockResolvedValueOnce([{ id: 'role-1' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: 'role-2' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: 'role-3' }])
        .mockResolvedValueOnce(undefined);

      await seedReportMeetingActivityExportPermission(mockDataSource);

      const allCalls = mockQueryRunner.query.mock.calls;

      const roleLookupCalls = allCalls.filter(
        (call: [string, unknown[]]) =>
          typeof call[0] === 'string' &&
          call[0].includes('SELECT id FROM roles WHERE role_code'),
      );
      const queriedRoleCodes = roleLookupCalls.map(
        (call: [string, unknown[]]) => call[1][0],
      );

      expect(queriedRoleCodes).toContain('MANAGER');
      expect(queriedRoleCodes).toContain('BUSINESS_ADMIN');
      expect(queriedRoleCodes).toContain('SYSTEM_ADMIN');
      expect(queriedRoleCodes).toHaveLength(3);

      const insertRolePerm = allCalls.filter(
        (call: [string, unknown[]]) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO role_permissions'),
      );
      expect(insertRolePerm).toHaveLength(3);
    });

    it('rolls back on error', async () => {
      mockQueryRunner.query.mockRejectedValue(new Error('DB Error'));

      await expect(
        seedReportMeetingActivityExportPermission(mockDataSource),
      ).rejects.toThrow('DB Error');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('migration class', () => {
    let migration: SeedReportMeetingActivityExportPermission20260703000001;

    beforeEach(() => {
      migration =
        new SeedReportMeetingActivityExportPermission20260703000001();
    });

    it('up inserts permission and assigns to 3 roles', async () => {
      mockQueryRunner.query
        .mockResolvedValueOnce([{ id: 'perm-1' }]) // INSERT permission
        .mockResolvedValue(undefined); // role_permission INSERTs

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
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM permissions'),
        expect.any(Array),
      );
    });
  });
});
