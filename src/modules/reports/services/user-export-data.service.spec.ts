/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { UserExportDataService } from './user-export-data.service.js';

describe('UserExportDataService (BE-04)', () => {
  let service: UserExportDataService;
  let userQb: any;
  let userRoleQb: any;
  let userRepo: any;
  let userRoleRepo: any;

  const userRow = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    employeeCode: 'NV001',
    fullName: 'Nguyễn Văn A',
    email: 'a@test.com',
    phoneNumber: '0900000000',
    departmentId: 'dept-1',
    accountStatus: 'active',
    createdAt: new Date('2026-01-01'),
    ...over,
  });

  beforeEach(() => {
    userQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    userRoleQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    userRepo = { createQueryBuilder: jest.fn().mockReturnValue(userQb) };
    userRoleRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(userRoleQb),
    };

    service = new UserExportDataService(userRepo, userRoleRepo);
  });

  it('không filter nào → chỉ where deletedAt IS NULL', async () => {
    userQb.getMany.mockResolvedValue([userRow()]);
    const result = await service.listUsersForExport({});
    expect(userQb.where).toHaveBeenCalledWith('u.deletedAt IS NULL');
    expect(result).toHaveLength(1);
  });

  it('filter departmentId → andWhere đúng field', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({ departmentId: 'dept-1' });
    expect(userQb.andWhere).toHaveBeenCalledWith(
      'u.departmentId = :departmentId',
      { departmentId: 'dept-1' },
    );
  });

  it('locked=true → filter accountStatus=locked', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({ locked: true });
    expect(userQb.andWhere).toHaveBeenCalledWith(
      'u.accountStatus = :accountStatus',
      { accountStatus: 'locked' },
    );
  });

  it('locked=false → filter accountStatus=active', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({ locked: false });
    expect(userQb.andWhere).toHaveBeenCalledWith(
      'u.accountStatus = :accountStatus',
      { accountStatus: 'active' },
    );
  });

  it('locked=undefined → KHÔNG filter accountStatus', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({});
    const calledWithAccountStatus = userQb.andWhere.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('accountStatus'),
    );
    expect(calledWithAccountStatus).toBe(false);
  });

  it('không lấy passwordHash — chỉ select field an toàn', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({});
    const selectedFields = userQb.select.mock.calls[0][0];
    expect(selectedFields).not.toContain('u.passwordHash');
  });

  it('gộp roles theo user (1 query duy nhất, không N+1)', async () => {
    userQb.getMany.mockResolvedValue([
      userRow({ id: 'u1' }),
      userRow({ id: 'u2' }),
    ]);
    userRoleQb.getMany.mockResolvedValue([
      { userId: 'u1', role: { roleCode: 'EMPLOYEE' } },
      { userId: 'u1', role: { roleCode: 'MANAGER' } },
      { userId: 'u2', role: { roleCode: 'EMPLOYEE' } },
    ]);

    const result = await service.listUsersForExport({});

    expect(userRoleRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(result.find((r) => r.id === 'u1')?.roles).toEqual([
      'EMPLOYEE',
      'MANAGER',
    ]);
    expect(result.find((r) => r.id === 'u2')?.roles).toEqual(['EMPLOYEE']);
  });

  it('không có user nào → không query roles (userIds rỗng)', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({});
    expect(userRoleRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('có LIMIT trần an toàn (take)', async () => {
    userQb.getMany.mockResolvedValue([]);
    await service.listUsersForExport({});
    expect(userQb.take).toHaveBeenCalledWith(10000);
  });
});
