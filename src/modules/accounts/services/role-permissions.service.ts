import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { RoleEntity } from '../entities/role.entity.js';
import { PermissionEntity } from '../entities/permission.entity.js';
import { RolePermissionEntity } from '../entities/role-permission.entity.js';
import { AssignPermissionsDto } from '../dto/assign-permissions.dto.js';
import { AssignPermissionsResponseDto } from '../dto/assign-permissions-response.dto.js';
import { RolePermissionResponseDto } from '../dto/role-permission-response.dto.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

@Injectable()
export class RolePermissionsService {
  private readonly logger = new Logger(RolePermissionsService.name);

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findByRole(roleId: string): Promise<RolePermissionResponseDto[]> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException({
        success: false,
        message: 'Role không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    const records = await this.rolePermissionRepo.find({
      where: { roleId },
      relations: { permission: true },
      order: { grantedAt: 'desc' },
    });

    return records.map((r) => ({
      id: r.id,
      roleId: r.roleId,
      permissionId: r.permissionId,
      grantedBy: r.grantedBy,
      grantedAt: r.grantedAt,
      permission: {
        id: r.permission.id,
        permissionCode: r.permission.permissionCode,
        permissionName: r.permission.permissionName,
        moduleCode: r.permission.moduleCode,
        actionCode: r.permission.actionCode,
        description: r.permission.description,
        isActive: r.permission.isActive,
        createdAt: r.permission.createdAt,
        updatedAt: r.permission.updatedAt,
      },
    }));
  }

  async assign(
    roleId: string,
    dto: AssignPermissionsDto,
    grantedBy: string,
  ): Promise<AssignPermissionsResponseDto> {
    // Phase 1 — Validate (fatal errors)
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException({
        success: false,
        message: 'Role không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    const permissionIds = [...new Set(dto.permissionIds)];
    const duplicatesInRequest =
      dto.permissionIds.length !== permissionIds.length
        ? dto.permissionIds.filter(
            (id, idx) => dto.permissionIds.indexOf(id) !== idx,
          )
        : [];

    const permissions = await this.permissionRepo.find({ where: { id: In(permissionIds) } });
    if (permissions.length !== permissionIds.length) {
      const foundIds = permissions.map((p) => p.id);
      const missingIds = permissionIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException({
        success: false,
        message: `Permission không tồn tại: ${missingIds.join(', ')}`,
        error: { code: 'PERMISSION_NOT_FOUND', details: { missingIds } },
      });
    }

    const inactivePerm = permissions.find((p) => !p.isActive);
    if (inactivePerm) {
      throw new UnprocessableEntityException({
        success: false,
        message: `Permission '${inactivePerm.permissionCode}' đang ở trạng thái inactive, không thể gán.`,
        error: { code: 'PERMISSION_INACTIVE', details: { permissionId: inactivePerm.id } },
      });
    }

    // Phase 2 — Process with transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Find already assigned
      const existingRecords = await this.rolePermissionRepo.find({
        where: permissionIds.map((pid) => ({ roleId, permissionId: pid })),
      });
      const existingPermissionIds = new Set(
        existingRecords.map((r) => r.permissionId),
      );

      const toAssign = permissionIds.filter(
        (pid) => !existingPermissionIds.has(pid),
      );
      const skippedAlreadyAssigned = permissionIds.filter((pid) =>
        existingPermissionIds.has(pid),
      );

      if (toAssign.length === 0) {
        await queryRunner.rollbackTransaction();
        return {
          assigned: [],
          skippedAlreadyAssigned,
          skippedDuplicatedInRequest: duplicatesInRequest,
        };
      }

      // Insert new records
      const newRecords = toAssign.map((pid) =>
        this.rolePermissionRepo.create({
          roleId,
          permissionId: pid,
          grantedBy,
          grantedAt: new Date(),
        }),
      );
      await queryRunner.manager.save(newRecords);
      await queryRunner.commitTransaction();

      // Audit log (after successful transaction)
      await this.auditLogsService.logAction({
        userId: grantedBy,
        actionType: 'ASSIGN_PERMISSION',
        entityType: 'role_permission',
        entityId: roleId,
        metadataJson: {
          assignedPermissionIds: toAssign,
          skippedAlreadyAssigned,
          skippedDuplicatedInRequest: duplicatesInRequest,
        },
      });

      return {
        assigned: toAssign,
        skippedAlreadyAssigned,
        skippedDuplicatedInRequest: duplicatesInRequest,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Bulk assign transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async revoke(
    roleId: string,
    permissionId: string,
    userId: string,
  ): Promise<void> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException({
        success: false,
        message: 'Role không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    const record = await this.rolePermissionRepo.findOne({
      where: { roleId, permissionId },
      relations: { permission: true },
    });
    if (!record) {
      throw new NotFoundException({
        success: false,
        message: 'Permission chưa được gán cho role này.',
        error: { code: 'PERMISSION_NOT_ASSIGNED' },
      });
    }

    // Check system role protection
    if (role.isSystemRole && record.permission.moduleCode === 'admin') {
      throw new UnprocessableEntityException({
        success: false,
        message:
          'Không thể gỡ permission module admin khỏi system role để tránh lockout hệ thống.',
        error: { code: 'CANNOT_REVOKE_SYSTEM_PERMISSION' },
      });
    }

    await this.rolePermissionRepo.remove(record);

    // Audit log
    await this.auditLogsService.logAction({
      userId,
      actionType: 'REVOKE_PERMISSION',
      entityType: 'role_permission',
      entityId: permissionId,
      metadataJson: { roleId },
    });
  }
}
