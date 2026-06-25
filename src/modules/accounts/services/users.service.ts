import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, ILike, IsNull } from 'typeorm';
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
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';

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
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';

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
    private readonly notificationsService: NotificationsService,
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
    let tempPassword: string;

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
      tempPassword =
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

      // 10. Write audit log (non-blocking)
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

    // ── After transaction: enqueue credential email via NotificationsService ──
    // NotificationsService tạo notification row + background_job + BullMQ job;
    // NotificationWorkerService xử lý job 'send-email' để gửi mail thực tế.
    const credentialContent = [
      'Kính gửi ' + createdUser!.fullName + ',',
      '',
      'Tài khoản Smart Meeting của bạn đã được tạo thành công.',
      '',
      'Thông tin đăng nhập:',
      '- Email: ' + email,
      '- Mật khẩu tạm thời: ' + tempPassword!,
      '',
      'Vui lòng đăng nhập và đổi mật khẩu ngay sau lần đầu tiên.',
      '',
      'Trân trọng,',
      'Hệ thống Smart Meeting Management',
    ].join('\n');

    try {
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.ACCOUNT_WELCOME,
        channel: NotificationChannel.EMAIL,
        subject: 'Thông tin tài khoản Smart Meeting mới của bạn',
        content: credentialContent,
        toEmails: [email],
        relatedEntityType: 'users',
        relatedEntityId: createdUser!.id,
        recipientScope: 'user_list',
        createdBy: creatorId,
        payloadJson: {
          fullName: createdUser!.fullName,
          username: email,
          mustChangePassword: true,
        },
      });
    } catch (enqueueError) {
      this.logger.error(
        `Failed to enqueue welcome email for user ${createdUser!.id}: ${(enqueueError as Error).message}`,
      );
      // Non-blocking: ghi warning audit log, KHÔNG rollback tạo user
      try {
        await this.dataSource.manager.save(AuditLogEntity, {
          userId: creatorId,
          actionType: 'NOTIFICATION_ENQUEUE_FAILED',
          entityType: 'users',
          entityId: createdUser!.id,
          severity: AuditLogSeverity.WARNING,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
          metadataJson: {
            error: 'Failed to enqueue welcome credential email',
            details: (enqueueError as Error).message,
          },
        } as any);
      } catch (auditError) {
        this.logger.error(
          `Failed to write audit log for notification failure of user ${createdUser!.id}: ${(auditError as Error).message}`,
        );
      }
    }

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

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ data: UserListItemDto[]; total: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const search = query.search?.trim();

    const baseWhere = {
      deletedAt: IsNull(),
      accountStatus: AccountStatus.ACTIVE,
    };

    const where = search
      ? [
          { ...baseWhere, fullName: ILike(`%${search}%`) },
          { ...baseWhere, email: ILike(`%${search}%`) },
        ]
      : baseWhere;

    const [entities, total] = await this.dataSource
      .getRepository(UserEntity)
      .findAndCount({
        where,
        select: { id: true, fullName: true, email: true },
        order: { fullName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      });

    const data: UserListItemDto[] = entities.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
    }));

    return { data, total };
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
