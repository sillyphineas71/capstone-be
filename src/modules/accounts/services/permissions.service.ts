import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { PermissionEntity } from '../entities/permission.entity.js';
import { CreatePermissionDto } from '../dto/create-permission.dto.js';
import { UpdatePermissionDto } from '../dto/update-permission.dto.js';
import { PermissionResponseDto } from '../dto/permission-response.dto.js';
import { PaginationQueryDto } from '../dto/pagination-query.dto.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { getPermissionDependencies } from '../constants/permission-dependencies.constant.js';

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreatePermissionDto,
    userId: string,
  ): Promise<PermissionResponseDto> {
    const existing = await this.permissionRepo.findOne({
      where: { permissionCode: dto.permissionCode },
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: `Permission code '${dto.permissionCode}' đã tồn tại trong hệ thống.`,
        error: { code: 'PERMISSION_CODE_DUPLICATE' },
      });
    }

    const entity = this.permissionRepo.create({
      permissionCode: dto.permissionCode,
      permissionName: dto.permissionName,
      moduleCode: dto.moduleCode,
      actionCode: dto.actionCode,
      description: dto.description ?? null,
      isActive: true,
    });
    const saved = await this.permissionRepo.save(entity);

    // Audit log
    await this.auditLogsService.logAction({
      userId,
      actionType: 'CREATE_PERMISSION',
      entityType: 'permission',
      entityId: saved.id,
      metadataJson: { permissionCode: saved.permissionCode },
    });

    return this.toResponse(saved);
  }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<{ data: PermissionResponseDto[]; total: number }> {
    const { page, limit, sortBy, sortOrder, moduleCode, search } = query;

    const where: any = {};
    if (moduleCode) {
      where.moduleCode = moduleCode;
    }
    if (search) {
      where.permissionCode = ILike(`%${search}%`);
    }

    const [entities, total] = await this.permissionRepo.findAndCount({
      where,
      order: { [sortBy || 'createdAt']: sortOrder || 'desc' },
      skip: ((page || 1) - 1) * (limit || 20),
      take: limit || 20,
    });

    return { data: entities.map((e) => this.toResponse(e)), total };
  }

  async findOne(id: string): Promise<PermissionResponseDto> {
    const entity = await this.permissionRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Permission không tồn tại.',
        error: { code: 'PERMISSION_NOT_FOUND' },
      });
    }
    return this.toResponse(entity);
  }

  async update(
    id: string,
    dto: UpdatePermissionDto,
    userId: string,
  ): Promise<PermissionResponseDto> {
    const entity = await this.permissionRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Permission không tồn tại.',
        error: { code: 'PERMISSION_NOT_FOUND' },
      });
    }

    const oldValue = {
      permissionName: entity.permissionName,
      description: entity.description,
    };

    if (dto.permissionName !== undefined) {
      entity.permissionName = dto.permissionName;
    }
    if (dto.description !== undefined) {
      entity.description = dto.description;
    }

    const saved = await this.permissionRepo.save(entity);

    // Audit log
    await this.auditLogsService.logAction({
      userId,
      actionType: 'UPDATE_PERMISSION',
      entityType: 'permission',
      entityId: saved.id,
      metadataJson: {
        oldValue,
        newValue: {
          permissionName: saved.permissionName,
          description: saved.description,
        },
      },
    });

    return this.toResponse(saved);
  }

  async toggleActive(
    id: string,
    userId: string,
  ): Promise<{ id: string; isActive: boolean }> {
    const entity = await this.permissionRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Permission không tồn tại.',
        error: { code: 'PERMISSION_NOT_FOUND' },
      });
    }

    const oldIsActive = entity.isActive;
    entity.isActive = !entity.isActive;
    const saved = await this.permissionRepo.save(entity);

    // Audit log
    await this.auditLogsService.logAction({
      userId,
      actionType: 'TOGGLE_PERMISSION',
      entityType: 'permission',
      entityId: saved.id,
      metadataJson: { oldValue: oldIsActive, newValue: saved.isActive },
    });

    return { id: saved.id, isActive: saved.isActive };
  }

  private toResponse(entity: PermissionEntity): PermissionResponseDto {
    return {
      id: entity.id,
      permissionCode: entity.permissionCode,
      permissionName: entity.permissionName,
      moduleCode: entity.moduleCode,
      actionCode: entity.actionCode,
      description: entity.description,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      dependsOn: getPermissionDependencies(entity.permissionCode),
    };
  }
}
