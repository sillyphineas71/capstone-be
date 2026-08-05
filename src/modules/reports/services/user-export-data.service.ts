import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { UserRoleEntity } from '../../accounts/entities/user-role.entity.js';

const MAX_EXPORT_ROWS = 10000;

export interface UserExportFilter {
  search?: string;
  departmentId?: string;
  roleId?: string;
  locked?: boolean;
}

export interface UserExportRow {
  id: string;
  employeeCode: string | null;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  departmentId: string | null;
  departmentName: string | null;
  accountStatus: string;
  roles: string[];
  createdAt: Date;
}

/**
 * UserExportDataService (BE-04) — truy vấn user cho export XLSX.
 *
 * Tái dùng logic filter của `listUsersForManagement` (`users.service.ts:1726`) —
 * departmentId/roleId/search — nhưng KHÔNG import `UsersService`/`AccountsModule` (tránh
 * vòng lặp `AccountsModule → ReportsModule → AccountsModule`, xem T-5.1). Entity inject
 * trực tiếp qua `TypeOrmModule.forFeature`, mirror pattern các data service khác trong
 * `ReportsModule`.
 *
 * KHÔNG lấy `passwordHash` hay field nhạy cảm khác (§20.1 CLAUDE.md) — chỉ SELECT tường
 * minh các cột cần cho export.
 *
 * [Residual] KHÔNG áp dụng department-scope restriction như `listUsersForManagement` áp
 * cho BUSINESS_ADMIN không phải SYSTEM_ADMIN (chỉ xem được phòng ban mình quản lý) — export
 * hiện chỉ gate bằng permission `accounts.user.export`. Nếu cần siết theo scope, phải làm ở
 * đợt sau (cần duplicate hoặc export lại `resolveDepartmentScope`).
 */
@Injectable()
export class UserExportDataService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
  ) {}

  async listUsersForExport(filter: UserExportFilter): Promise<UserExportRow[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.department', 'department')
      .where('u.deletedAt IS NULL');

    if (filter.departmentId) {
      qb.andWhere('u.departmentId = :departmentId', {
        departmentId: filter.departmentId,
      });
    }
    if (filter.locked !== undefined) {
      qb.andWhere('u.accountStatus = :accountStatus', {
        accountStatus: filter.locked ? 'locked' : 'active',
      });
    }
    if (filter.roleId) {
      qb.andWhere(
        'u.id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.role_id = :roleId AND ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > NOW()))',
        { roleId: filter.roleId },
      );
    }
    const search = filter.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.fullName ILIKE :s', { s: `%${search}%` })
            .orWhere('u.email ILIKE :s', { s: `%${search}%` })
            .orWhere('u.employeeCode ILIKE :s', { s: `%${search}%` });
        }),
      );
    }

    qb.select([
      'u.id',
      'u.employeeCode',
      'u.fullName',
      'u.email',
      'u.phoneNumber',
      'u.departmentId',
      'u.accountStatus',
      'u.createdAt',
      'department.departmentName',
    ])
      .orderBy('u.fullName', 'ASC')
      .take(MAX_EXPORT_ROWS);

    const users = await qb.getMany();

    const userIds = users.map((u) => u.id);
    const rolesMap = new Map<string, string[]>();
    if (userIds.length > 0) {
      const userRoles = await this.userRoleRepo
        .createQueryBuilder('ur')
        .innerJoinAndSelect('ur.role', 'r')
        .where('ur.userId IN (:...userIds)', { userIds })
        .andWhere('ur.isActive = true')
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > NOW())')
        .getMany();

      for (const ur of userRoles) {
        const list = rolesMap.get(ur.userId) ?? [];
        list.push(ur.role.roleCode);
        rolesMap.set(ur.userId, list);
      }
    }

    return users.map((u) => ({
      id: u.id,
      employeeCode: u.employeeCode,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      departmentId: u.departmentId,
      departmentName: u.department?.departmentName ?? null,
      accountStatus: u.accountStatus,
      roles: rolesMap.get(u.id) ?? [],
      createdAt: u.createdAt,
    }));
  }
}
