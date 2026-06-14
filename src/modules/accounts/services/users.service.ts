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
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { NotificationsService } from '../../notifications/notifications.service.js';
import { NotificationType, NotificationChannel } from '../../notifications/entities/notification.entity.js';

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

    // ── Transaction: core business data only ──
    await this.dataSource.transaction(async (em) => {
      // 1. Check duplicate email
      const existingEmail = await em.findOne(UserEntity, {
        where: { email, deletedAt: IsNull() },
      });
      if (existingEmail) {
        throw new ConflictException({
          success: false,
          message: 'Äá»‹a chá»‰ email nÃ y Ä‘Ã£ Ä‘Æ°á»£c sá»­ dá»¥ng cho má»™t tÃ i khoáº£n khÃ¡c.',
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
          message: 'TÃªn ngÆ°á»i dÃ¹ng nÃ y Ä‘Ã£ tá»“n táº¡i trong há»‡ thá»‘ng.',
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
          message: 'PhÃ²ng ban Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh khÃ´ng tá»“n táº¡i.',
          error: {
            code: 'DEPARTMENT_NOT_FOUND',
            details: { departmentId: dto.departmentId },
          },
        });
      }
      if (!department.isActive) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'PhÃ²ng ban Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh khÃ´ng hoáº¡t Ä‘á»™ng hoáº·c Ä‘Ã£ bá»‹ xÃ³a.',
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
            message: 'Má»™t hoáº·c nhiá»u vai trÃ² Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh khÃ´ng tá»“n táº¡i.',
            error: { code: 'ROLE_NOT_FOUND', details: { roleId } },
          });
        }
        if (!role.isActive) {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Má»™t hoáº·c nhiá»u vai trÃ² Ä‘Æ°á»£c chá»n Ä‘ang á»Ÿ tráº¡ng thÃ¡i khÃ´ng hoáº¡t Ä‘á»™ng.',
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
            message: 'MÃ£ nhÃ¢n viÃªn nÃ y Ä‘Ã£ Ä‘Æ°á»£c Ä‘Äƒng kÃ½ bá»Ÿi tÃ i khoáº£n khÃ¡c.',
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
            message: 'NgÆ°á»i quáº£n lÃ½ trá»±c tiáº¿p khÃ´ng tá»“n táº¡i trong há»‡ thá»‘ng.',
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
              'NgÆ°á»i quáº£n lÃ½ trá»±c tiáº¿p Ä‘ang bá»‹ khÃ³a, chÆ°a kÃ­ch hoáº¡t hoáº·c Ä‘Ã£ nghá»‰ viá»‡c.',
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

      // 10. Write audit log (non-blocking, inside transaction)
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
    const credentialContent = [
      'Kính g?i ' + createdUser!.fullName + ',',
      '',
      'Tài kho?n Smart Meeting c?a b?n dã du?c t?o thành công.',
      '',
      'Thông tin d?ng nh?p:',
      '- Email: ' + email,
      '',
      'Vui lòng d?ng nh?p và d?i m?t kh?u ngay sau l?n d?u tiên.',
      '',
      'Trân tr?ng,',
      'H? th?ng Smart Meeting Management',
    ].join('\n');

    try {
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.ACCOUNT_WELCOME,
        channel: NotificationChannel.EMAIL,
        subject: 'Thông tin tài kho?n Smart Meeting m?i c?a b?n',
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
      // Non-blocking: write warning audit log, do NOT rollback user creation
      try {
        const em = this.dataSource.manager;
        await em.save(AuditLogEntity, {
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
        message: 'Không tìm th?y tài kho?n.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // 2. Determine authenticated user role
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
          message: 'B?n không có quy?n xem h? s? c?a nhân s? này.',
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
