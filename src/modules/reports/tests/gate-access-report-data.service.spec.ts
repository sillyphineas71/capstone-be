/**
 * gate-access-report-data.service.spec.ts
 *
 * Unit tests cho GateAccessReportDataService (UC-127 T117).
 *
 * §0.2 spec: phiên vãng lai (user_id=null) VẪN xuất hiện khi không filter theo
 *   department/user — verify qua SQL params/where thay vì mock trực tiếp filter
 *   (data thật do Postgres LEFT JOIN quyết định, ở đây verify query được build đúng).
 * §0.3 spec: chỉ session_status='completed' — verify WHERE clause có điều kiện này.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GateAccessReportDataService } from '../services/gate-access-report-data.service.js';

describe('GateAccessReportDataService', () => {
  let service: GateAccessReportDataService;
  const mockManagerQuery = jest.fn();
  const mockDataSource = { manager: { query: mockManagerQuery } };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockManagerQuery.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessReportDataService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<GateAccessReportDataService>(
      GateAccessReportDataService,
    );
  });

  const baseParams = {
    from: '2026-07-01',
    to: '2026-07-31',
    scope: { zoneId: null, departmentId: null, userId: null },
  };

  it('§0.3: always filters session_status = completed (excludes incomplete)', async () => {
    await service.listSessionsForExport(baseParams);

    const [sql] = mockManagerQuery.mock.calls[0];
    expect(sql).toContain(`sessions.session_status = 'completed'`);
  });

  it('§0.2: does NOT filter by department/user when scope is empty — walk-in sessions survive', async () => {
    await service.listSessionsForExport(baseParams);

    const [sql, params] = mockManagerQuery.mock.calls[0];
    expect(sql).not.toContain('u.department_id =');
    expect(sql).not.toContain('sessions.user_id =');
    // Only from/to bound (no scope filter params added)
    expect(params).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('applies zoneId filter when scope.zoneId is provided', async () => {
    await service.listSessionsForExport({
      ...baseParams,
      scope: { zoneId: 'zone-1', departmentId: null, userId: null },
    });

    const [sql, params] = mockManagerQuery.mock.calls[0];
    expect(sql).toContain('sessions.zone_id = $3');
    expect(params).toEqual(['2026-07-01', '2026-07-31', 'zone-1']);
  });

  it('applies departmentId filter via JOIN users.department_id', async () => {
    await service.listSessionsForExport({
      ...baseParams,
      scope: { zoneId: null, departmentId: 'dept-1', userId: null },
    });

    const [sql, params] = mockManagerQuery.mock.calls[0];
    expect(sql).toContain('u.department_id = $3');
    expect(params).toContain('dept-1');
  });

  it('LEFT JOINs users (not INNER) so rows without user_id are not dropped by the join itself', async () => {
    await service.listSessionsForExport(baseParams);

    const [sql] = mockManagerQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN users u ON u.id = sessions.user_id');
  });

  it('maps DB rows into camelCase export rows', async () => {
    mockManagerQuery.mockResolvedValueOnce([
      {
        zone_code: 'GATE-01',
        zone_name: 'Cổng chính',
        employee_code: 'NV001',
        full_name: 'Nguyễn Văn A',
        department_name: 'Kỹ thuật',
        plate_number: '29A12345',
        check_in_time: new Date('2026-07-05T08:00:00Z'),
        check_out_time: new Date('2026-07-05T17:00:00Z'),
        duration_seconds: 32400,
      },
    ]);

    const rows = await service.listSessionsForExport(baseParams);

    expect(rows).toEqual([
      {
        zoneCode: 'GATE-01',
        zoneName: 'Cổng chính',
        employeeCode: 'NV001',
        fullName: 'Nguyễn Văn A',
        departmentName: 'Kỹ thuật',
        plateNumber: '29A12345',
        checkInTime: new Date('2026-07-05T08:00:00Z'),
        checkOutTime: new Date('2026-07-05T17:00:00Z'),
        durationSeconds: 32400,
      },
    ]);
  });

  it('maps walk-in row (no user) with null identity fields, non-null plate', async () => {
    mockManagerQuery.mockResolvedValueOnce([
      {
        zone_code: 'GATE-01',
        zone_name: 'Cổng chính',
        employee_code: null,
        full_name: null,
        department_name: null,
        plate_number: '30B67890',
        check_in_time: new Date('2026-07-05T08:00:00Z'),
        check_out_time: new Date('2026-07-05T09:00:00Z'),
        duration_seconds: 3600,
      },
    ]);

    const rows = await service.listSessionsForExport(baseParams);

    expect(rows[0].employeeCode).toBeNull();
    expect(rows[0].fullName).toBeNull();
    expect(rows[0].plateNumber).toBe('30B67890');
  });
});
