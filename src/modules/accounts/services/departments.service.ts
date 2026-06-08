import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { DepartmentEntity } from '../entities/department.entity.js';
import { UserEntity } from '../entities/user.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { CreateDepartmentDto } from '../dto/create-department.dto.js';
import { DepartmentResponseDto } from '../dto/department-response.dto.js';

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

const MAX_DEPTH = 5;

const idempotencyCache = new Map<
  string,
  { response: DepartmentResponseDto; payloadHash: string }
>();

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async createDepartment(
    dto: CreateDepartmentDto,
    creatorId: string,
    clientContext: ClientContext,
    idempotencyKey?: string,
  ): Promise<DepartmentResponseDto> {
    const departmentCode = dto.departmentCode.trim().toUpperCase();
    const departmentName = dto.departmentName.trim();
    const description =
      typeof dto.description === 'string' && dto.description.trim() !== ''
        ? dto.description.trim()
        : null;

    const sanitizedName = this.stripHtml(departmentName);
    const sanitizedDescription = description
      ? this.stripHtml(description)
      : null;

    // Idempotency check
    if (idempotencyKey) {
      const cacheKey = creatorId + ':' + idempotencyKey;
      const cached = idempotencyCache.get(cacheKey);
      if (cached) {
        const currentPayloadHash = this.hashPayload(dto);
        if (cached.payloadHash === currentPayloadHash) {
          this.logger.debug('Idempotency hit for key=' + idempotencyKey);
          return cached.response;
        }
        throw new ConflictException({
          success: false,
          message: 'Idempotency-Key da duoc su dung voi payload khac.',
          error: { code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' },
        });
      }
    }

    let createdDept: DepartmentEntity;

    await this.dataSource.transaction(async (em) => {
      // 1. Check duplicate departmentCode
      const existingCode = await em.findOne(DepartmentEntity, {
        where: { departmentCode, deletedAt: IsNull() },
      });
      if (existingCode) {
        throw new ConflictException({
          success: false,
          message: 'Ma phong ban nay da duoc su dung.',
          error: {
            code: 'DEPARTMENT_ALREADY_EXISTS',
            details: { field: 'departmentCode' },
          },
        });
      }

      // 2. Check duplicate departmentName
      const existingName = await em.findOne(DepartmentEntity, {
        where: { departmentName: sanitizedName, deletedAt: IsNull() },
      });
      if (existingName) {
        throw new ConflictException({
          success: false,
          message: 'Ten phong ban nay da duoc su dung.',
          error: {
            code: 'DEPARTMENT_ALREADY_EXISTS',
            details: { field: 'departmentName' },
          },
        });
      }

      // 3. Validate parentDepartmentId
      if (dto.parentDepartmentId) {
        const parent = await em.findOne(DepartmentEntity, {
          where: { id: dto.parentDepartmentId, deletedAt: IsNull() },
        });
        if (!parent || !parent.isActive) {
          throw new NotFoundException({
            success: false,
            message: 'Phong ban cha khong ton tai hoac khong hoat dong.',
            error: {
              code: 'RESOURCE_NOT_FOUND',
              details: { field: 'parentDepartmentId' },
            },
          });
        }

        const depth = await this.calcDepth(em, dto.parentDepartmentId);
        if (depth + 1 > MAX_DEPTH) {
          throw new UnprocessableEntityException({
            success: false,
            message: 'Cay phan cap phong ban khong duoc vuot qua 5 cap.',
            error: {
              code: 'VALIDATION_ERROR',
              details: { field: 'parentDepartmentId' },
            },
          });
        }
      }

      // 4. Validate managerUserId
      if (dto.managerUserId) {
        const manager = await em.findOne(UserEntity, {
          where: { id: dto.managerUserId, deletedAt: IsNull() },
        });
        if (!manager || manager.accountStatus !== 'active') {
          throw new NotFoundException({
            success: false,
            message: 'Nguoi quan ly khong ton tai hoac khong hoat dong.',
            error: {
              code: 'RESOURCE_NOT_FOUND',
              details: { field: 'managerUserId' },
            },
          });
        }
      }

      // 5. Create department
      const dept = em.create(DepartmentEntity, {
        departmentCode,
        departmentName: sanitizedName,
        parentDepartmentId: dto.parentDepartmentId || null,
        managerUserId: dto.managerUserId || null,
        description: sanitizedDescription,
        isActive: true,
        createdBy: creatorId,
      });

      createdDept = await em.save(DepartmentEntity, dept);

      // 6. Write audit log
      try {
        const auditLog = em.create(AuditLogEntity, {
          userId: creatorId,
          actionType: 'create',
          entityType: 'department',
          entityId: createdDept.id,
          severity: AuditLogSeverity.INFO,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
          newValueJson: {
            id: createdDept.id,
            departmentCode: createdDept.departmentCode,
            departmentName: createdDept.departmentName,
            parentDepartmentId: createdDept.parentDepartmentId,
            managerUserId: createdDept.managerUserId,
            isActive: createdDept.isActive,
          },
        });
        await em.save(AuditLogEntity, auditLog);
      } catch (auditError) {
        this.logger.error(
          'Failed to save audit log for department ' +
            createdDept.id +
            ': ' +
            (auditError as Error).message,
        );
      }
    });

    // Cache idempotency response
    if (idempotencyKey) {
      const cacheKey = creatorId + ':' + idempotencyKey;
      idempotencyCache.set(cacheKey, {
        response: {
          id: createdDept!.id,
          departmentCode: createdDept!.departmentCode,
          departmentName: createdDept!.departmentName,
          parentDepartmentId: createdDept!.parentDepartmentId,
          managerUserId: createdDept!.managerUserId,
          description: createdDept!.description,
          isActive: createdDept!.isActive,
          createdAt: createdDept!.createdAt,
          updatedAt: createdDept!.updatedAt,
        },
        payloadHash: this.hashPayload({
          departmentCode: dto.departmentCode,
          departmentName: dto.departmentName,
        }),
      });
      setTimeout(function () {
        idempotencyCache.delete(cacheKey);
      }, 86400000);
    }

    return {
      id: createdDept!.id,
      departmentCode: createdDept!.departmentCode,
      departmentName: createdDept!.departmentName,
      parentDepartmentId: createdDept!.parentDepartmentId,
      managerUserId: createdDept!.managerUserId,
      description: createdDept!.description,
      isActive: createdDept!.isActive,
      createdAt: createdDept!.createdAt,
      updatedAt: createdDept!.updatedAt,
    };
  }

  private async calcDepth(em: any, deptId: string): Promise<number> {
    let depth = 1;
    let currentId: string | null = deptId;
    while (currentId) {
      const dept = await em.findOne(DepartmentEntity, {
        where: { id: currentId },
        select: ['id', 'parentDepartmentId'],
      });
      if (!dept || !dept.parentDepartmentId) {
        break;
      }
      currentId = dept.parentDepartmentId;
      depth++;
    }
    return depth;
  }

  private stripHtml(input: string): string {
    return input.replace(/<[^>]*>/g, '');
  }

  private hashPayload(dto: {
    departmentCode: string;
    departmentName: string;
  }): string {
    return (
      dto.departmentCode.trim().toUpperCase() + '::' + dto.departmentName.trim()
    );
  }
}
