import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import {
  UserEntity,
  EmploymentStatus,
  AccountStatus,
} from '../entities/user.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import { FaceProfileEntity } from '../entities/face-profile.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { PasswordGeneratorService } from './password-generator.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import {
  UserResponseDto,
  UserRoleResponseDto,
} from '../dto/user-response.dto.js';
import {
  UserDetailResponseDto,
  DepartmentInfoDto,
  DirectManagerInfoDto,
  RoleInfoDto,
} from '../dto/user-detail-response.dto.js';

export interface UserClientContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly MAX_DEPARTMENT_SCOPE_DEPTH = 5;

  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordGeneratorService: PasswordGeneratorService,
  ) {}

  async createUser(
    dto: CreateUserDto,
    creatorId: string,
    clientContext: UserClientContext,
  ): Promise<UserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const employeeCode = dto.employeeCode ? dto.employeeCode.trim() : null;

    let createdUser: UserEntity;
    let roles: RoleEntity[] = [];

    // Run transaction
    await this.dataSource.transaction(async (em) => {
      // 1. Check duplicate email
      const existingEmail = await em.findOne(UserEntity, {
        where: { email, deletedAt: IsNull() },
      });
      if (existingEmail) {
        throw new ConflictException({
          success: false,
          message: 'Địa chỉ email này đã được sử dụng cho một tài khoản khác.',
          error: { code: 'ACCOUNT_EMAIL_ALREADY_EXISTS', details: { email } },
        });
      }

      // 2. Check duplicate username (since username = lower(email))
      const existingUsername = await em.findOne(UserEntity, {
        where: { username: email, deletedAt: IsNull() },
      });
      if (existingUsername) {
        throw new ConflictException({
          success: false,
          message: 'Tên người dùng này đã tồn tại trong hệ thống.',
          error: {
            code: 'ACCOUNT_USERNAME_ALREADY_EXISTS',
            details: { username: email },
          },
        });
      }

      // 3. Check active department
      const department = await em.findOne(DepartmentEntity, {
        where: { id: dto.departmentId, deletedAt: IsNull() },
      });
      if (!department) {
        throw new NotFoundException({
          success: false,
          message: 'Phòng ban được chỉ định không tồn tại.',
          error: {
            code: 'DEPARTMENT_NOT_FOUND',
            details: { departmentId: dto.departmentId },
          },
        });
      }
      if (!department.isActive) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Phòng ban được chỉ định không hoạt động hoặc đã bị xóa.',
          error: {
            code: 'DEPARTMENT_INACTIVE_OR_DELETED',
            details: { departmentId: dto.departmentId },
          },
        });
      }

      // 4. Check active roles
      roles = [];
      for (const roleId of dto.roleIds) {
        const role = await em.findOne(RoleEntity, {
          where: { id: roleId },
        });
        if (!role) {
          throw new NotFoundException({
            success: false,
            message: 'Một hoặc nhiều vai trò được chỉ định không tồn tại.',
            error: { code: 'ROLE_NOT_FOUND', details: { roleId } },
          });
        }
        if (!role.isActive) {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Một hoặc nhiều vai trò được chọn đang ở trạng thái không hoạt động.',
            error: { code: 'ROLE_INACTIVE', details: { roleId } },
          });
        }
        roles.push(role);
      }

      // 5. Check duplicate employeeCode (if provided)
      if (employeeCode) {
        const existingCode = await em.findOne(UserEntity, {
          where: { employeeCode, deletedAt: IsNull() },
        });
        if (existingCode) {
          throw new ConflictException({
            success: false,
            message: 'Mã nhân viên này đã được đăng ký bởi tài khoản khác.',
            error: {
              code: 'ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS',
              details: { employeeCode },
            },
          });
        }
      }

      // 6. Check active manager (if provided)
      if (dto.directManagerId) {
        const manager = await em.findOne(UserEntity, {
          where: { id: dto.directManagerId, deletedAt: IsNull() },
        });
        if (!manager) {
          throw new NotFoundException({
            success: false,
            message: 'Người quản lý trực tiếp không tồn tại trong hệ thống.',
            error: {
              code: 'MANAGER_NOT_FOUND',
              details: { directManagerId: dto.directManagerId },
            },
          });
        }
        if (
          manager.accountStatus !== AccountStatus.ACTIVE ||
          manager.employmentStatus === EmploymentStatus.RESIGNED
        ) {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Người quản lý trực tiếp đang bị khóa, chưa kích hoạt hoặc đã nghỉ việc.',
            error: {
              code: 'MANAGER_INACTIVE_OR_UNAVAILABLE',
              details: { directManagerId: dto.directManagerId },
            },
          });
        }
      }

      // 7. Generate temporary password and hash
      const tempPassword =
        this.passwordGeneratorService.generateTemporaryPassword(12);
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(tempPassword, salt);

      // 8. Create and save User
      const user = em.create(UserEntity, {
        fullName: dto.fullName.trim(),
        email,
        username: email,
        passwordHash,
        departmentId: dto.departmentId,
        employeeCode,
        phoneNumber: dto.phoneNumber ? dto.phoneNumber.trim() : null,
        positionTitle: dto.positionTitle ? dto.positionTitle.trim() : null,
        directManagerId: dto.directManagerId || null,
        employmentStatus: EmploymentStatus.ACTIVE,
        accountStatus: AccountStatus.ACTIVE,
        mustChangePassword: true,
      });

      createdUser = await em.save(UserEntity, user);

      // 9. Assign user_roles
      for (const role of roles) {
        const userRole = em.create(UserRoleEntity, {
          userId: createdUser.id,
          roleId: role.id,
          assignedBy: creatorId,
          isActive: true,
        });
        await em.save(UserRoleEntity, userRole);
      }

      // 10. Queue credential email in background_jobs
      const inputJson = {
        to: email,
        subject: 'Thông tin tài khoản Smart Meeting mới của bạn',
        template: 'welcome-credential',
        context: {
          fullName: createdUser.fullName,
          username: email,
          temporaryPassword: tempPassword,
          mustChangePassword: true,
        },
      };

      const emailJob = em.create(BackgroundJobEntity, {
        jobType: BackgroundJobType.SEND_EMAIL,
        relatedEntityType: 'users',
        relatedEntityId: createdUser.id,
        requestedBy: creatorId,
        status: BackgroundJobStatus.QUEUED,
        priority: 0,
        retryCount: 0,
        inputJson,
      });

      await em.save(BackgroundJobEntity, emailJob);

      // 11. Write audit log (non-blocking)
      try {
        const auditLog = em.create(AuditLogEntity, {
          userId: creatorId,
          actionType: 'ACCOUNT_CREATE',
          entityType: 'users',
          entityId: createdUser.id,
          severity: AuditLogSeverity.INFO,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
          newValueJson: {
            id: createdUser.id,
            email: createdUser.email,
            username: createdUser.username,
            fullName: createdUser.fullName,
            departmentId: createdUser.departmentId,
            employeeCode: createdUser.employeeCode,
            phoneNumber: createdUser.phoneNumber,
            roleIds: dto.roleIds,
          },
        });
        await em.save(AuditLogEntity, auditLog);
      } catch (auditError) {
        this.logger.error(
          `Failed to save audit log for user creation of ${createdUser.id}: ${(auditError as Error).message}`,
          (auditError as Error).stack,
        );
      }
    });

    // Map roles to DTO structure
    const rolesDto: UserRoleResponseDto[] = roles.map((role) => ({
      id: role.id,
      roleCode: role.roleCode,
      roleName: role.roleName,
    }));

    return {
      id: createdUser!.id,
      employeeCode: createdUser!.employeeCode,
      email: createdUser!.email,
      fullName: createdUser!.fullName,
      accountStatus: createdUser!.accountStatus,
      mustChangePassword: createdUser!.mustChangePassword,
      roles: rolesDto,
      createdAt: createdUser!.createdAt,
    };
  }

  async getUserDetail(
    targetUserId: string,
    authenticatedUserId: string,
    clientContext?: UserClientContext,
  ): Promise<UserDetailResponseDto> {
    const em = this.dataSource.manager;

    // 1. Fetch target user with department relation
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
      relations: { department: true },
    });

    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // 2. Determine authenticated user's role
    const authUserRoles = await em.find(UserRoleEntity, {
      where: { userId: authenticatedUserId, isActive: true },
      relations: { role: true },
    });

    const isSystemAdmin = authUserRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );

    // 3. Department scope check (only for Business Admin, skip self-view)
    if (!isSystemAdmin && targetUserId !== authenticatedUserId) {
      const scope = await this.resolveDepartmentScope(authenticatedUserId);

      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền xem hồ sơ của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // 4. Fetch active roles of target user
    const targetUserRoles = await em.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
      relations: { role: true },
    });

    const rolesDto: RoleInfoDto[] = targetUserRoles.map((ur) => ({
      id: ur.role.id,
      roleCode: ur.role.roleCode,
      roleName: ur.role.roleName,
    }));

    // 5. Fetch direct manager info
    let directManagerDto: DirectManagerInfoDto | null = null;
    if (targetUser.directManagerId) {
      const manager = await em.findOne(UserEntity, {
        where: { id: targetUser.directManagerId },
        select: { id: true, fullName: true },
      });
      if (manager) {
        directManagerDto = {
          id: manager.id,
          fullName: manager.fullName,
        };
      }
    }

    // 6. Fetch face profile existence
    const faceProfile = await em.findOne(FaceProfileEntity, {
      where: { userId: targetUserId },
    });

    // 7. Assemble department info
    let departmentDto: DepartmentInfoDto | null = null;
    if (targetUser.department) {
      departmentDto = {
        id: targetUser.department.id,
        departmentName: targetUser.department.departmentName,
      };
    }

    // 8. Assemble response DTO
    const response: UserDetailResponseDto = {
      id: targetUser.id,
      employeeCode: targetUser.employeeCode,
      email: targetUser.email,
      fullName: targetUser.fullName,
      phoneNumber: targetUser.phoneNumber,
      avatarUrl: targetUser.avatarUrl,
      positionTitle: targetUser.positionTitle,
      department: departmentDto,
      directManager: directManagerDto,
      accountStatus: targetUser.accountStatus,
      employmentStatus: targetUser.employmentStatus,
      mustChangePassword: targetUser.mustChangePassword,
      lastLoginAt: targetUser.lastLoginAt
        ? targetUser.lastLoginAt.toISOString()
        : null,
      roles: rolesDto,
      hasFaceProfile: !!faceProfile,
      createdAt: targetUser.createdAt.toISOString(),
    };

    // 9. Write audit log (non-blocking)
    try {
      const auditLog = em.create(AuditLogEntity, {
        userId: authenticatedUserId,
        actionType: 'view_detail',
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.INFO,
        ipAddress: clientContext?.ipAddress || null,
        userAgent: clientContext?.userAgent || null,
        requestId: clientContext?.requestId || null,
        newValueJson: {
          actorId: authenticatedUserId,
          targetId: targetUserId,
          timestamp: new Date().toISOString(),
        },
      });
      await em.save(AuditLogEntity, auditLog);
    } catch (auditError) {
      this.logger.error(
        `Failed to save audit log for view_detail of ${targetUserId}: ${(auditError as Error).message}`,
        (auditError as Error).stack,
      );
    }

    return response;
  }

  private async resolveDepartmentScope(
    adminUserId: string,
  ): Promise<Set<string>> {
    const em = this.dataSource.manager;

    const admin = await em.findOne(UserEntity, {
      where: { id: adminUserId, deletedAt: IsNull() },
      select: { departmentId: true },
    });

    if (!admin || !admin.departmentId) {
      return new Set<string>();
    }

    const scope = new Set<string>();
    await this.collectDepartmentScope(em, admin.departmentId, scope, 0);

    return scope;
  }

  private async collectDepartmentScope(
    em: import('typeorm').EntityManager,
    deptId: string,
    scope: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth >= this.MAX_DEPARTMENT_SCOPE_DEPTH) {
      return;
    }

    scope.add(deptId);

    const children = await em.find(DepartmentEntity, {
      where: {
        parentDepartmentId: deptId,
        isActive: true,
      },
      select: { id: true },
    });

    for (const child of children) {
      await this.collectDepartmentScope(em, child.id, scope, depth + 1);
    }
  }
}
