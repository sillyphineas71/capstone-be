import {
  BadRequestException,
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, IsNull, ILike, In } from 'typeorm';

import { DepartmentEntity } from '../entities/department.entity.js';
import {
  UserEntity,
  AccountStatus,
  EmploymentStatus,
} from '../entities/user.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';

import { CreateDepartmentDto } from '../dto/create-department.dto.js';
import { UpdateDepartmentDto } from '../dto/update-department.dto.js';
import { DepartmentResponseDto } from '../dto/department-response.dto.js';
import { ListDepartmentsQueryDto } from '../dto/list-departments-query.dto.js';
import { PaginationMeta } from '../dto/pagination-meta.dto.js';
import { DepartmentMemberItemDto } from '../dto/department-member-item.dto.js';

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

  /**
   * updateDepartment (BE-08) — PATCH /departments/:id.
   * KHÔNG cho sửa departmentCode. Body rỗng (mọi field undefined) → 400.
   */
  async updateDepartment(
    id: string,
    dto: UpdateDepartmentDto,
    updaterId: string,
    clientContext: ClientContext,
  ): Promise<DepartmentResponseDto> {
    if (
      dto.departmentName === undefined &&
      dto.parentDepartmentId === undefined &&
      dto.managerUserId === undefined &&
      dto.description === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Phải cung cấp ít nhất một trường để cập nhật.',
        error: { code: 'EMPTY_UPDATE_PAYLOAD', details: {} },
      });
    }

    let updatedDept: DepartmentEntity;

    await this.dataSource.transaction(async (em) => {
      const dept = await em.findOne(DepartmentEntity, { where: { id } });
      if (!dept || dept.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Phòng ban không tồn tại hoặc đã bị xóa.',
          error: { code: 'DEPARTMENT_NOT_FOUND', details: { id } },
        });
      }

      const before = {
        departmentName: dept.departmentName,
        parentDepartmentId: dept.parentDepartmentId,
        managerUserId: dept.managerUserId,
        description: dept.description,
        isActive: dept.isActive,
      };

      let departmentName = dept.departmentName;
      if (dto.departmentName !== undefined) {
        const sanitized = this.stripHtml(dto.departmentName);
        if (sanitized !== dept.departmentName) {
          const existingName = await em.findOne(DepartmentEntity, {
            where: { departmentName: sanitized, deletedAt: IsNull() },
          });
          if (existingName && existingName.id !== id) {
            throw new ConflictException({
              success: false,
              message: 'Tên phòng ban này đã được sử dụng.',
              error: {
                code: 'DEPARTMENT_ALREADY_EXISTS',
                details: { field: 'departmentName' },
              },
            });
          }
        }
        departmentName = sanitized;
      }

      let parentDepartmentId = dept.parentDepartmentId;
      if (dto.parentDepartmentId !== undefined) {
        if (dto.parentDepartmentId === null) {
          parentDepartmentId = null;
        } else {
          const newParentId = dto.parentDepartmentId;

          if (newParentId === id) {
            throw new UnprocessableEntityException({
              success: false,
              message: 'Phòng ban không thể là cha của chính nó.',
              error: {
                code: 'VALIDATION_ERROR',
                details: { field: 'parentDepartmentId' },
              },
            });
          }

          const parent = await em.findOne(DepartmentEntity, {
            where: { id: newParentId, deletedAt: IsNull() },
          });
          if (!parent || !parent.isActive) {
            throw new NotFoundException({
              success: false,
              message: 'Phòng ban cha không tồn tại hoặc không hoạt động.',
              error: {
                code: 'RESOURCE_NOT_FOUND',
                details: { field: 'parentDepartmentId' },
              },
            });
          }

          if (await this.wouldCreateCycle(em, id, newParentId)) {
            throw new UnprocessableEntityException({
              success: false,
              message:
                'Không thể đặt phòng ban cha là hậu duệ của chính phòng ban này (tạo chu trình).',
              error: {
                code: 'VALIDATION_ERROR',
                details: { field: 'parentDepartmentId' },
              },
            });
          }

          const depth = await this.calcDepth(em, newParentId);
          if (depth + 1 > MAX_DEPTH) {
            throw new UnprocessableEntityException({
              success: false,
              message: 'Cây phân cấp phòng ban không được vượt quá 5 cấp.',
              error: {
                code: 'VALIDATION_ERROR',
                details: { field: 'parentDepartmentId' },
              },
            });
          }

          parentDepartmentId = newParentId;
        }
      }

      let managerUserId = dept.managerUserId;
      if (dto.managerUserId !== undefined) {
        if (dto.managerUserId === null) {
          managerUserId = null;
        } else {
          const manager = await em.findOne(UserEntity, {
            where: { id: dto.managerUserId, deletedAt: IsNull() },
          });
          if (!manager || manager.accountStatus !== 'active') {
            throw new NotFoundException({
              success: false,
              message: 'Người quản lý không tồn tại hoặc không hoạt động.',
              error: {
                code: 'RESOURCE_NOT_FOUND',
                details: { field: 'managerUserId' },
              },
            });
          }
          managerUserId = dto.managerUserId;
        }
      }

      let description = dept.description;
      if (dto.description !== undefined) {
        description =
          dto.description === null ? null : this.stripHtml(dto.description);
      }

      let isActive = dept.isActive;
      if (dto.isActive !== undefined) {
        isActive = dto.isActive;
      }

      await em.update(DepartmentEntity, id, {
        departmentName,
        parentDepartmentId,
        managerUserId,
        description,
        isActive,
        updatedBy: updaterId,
      });

      updatedDept = {
        ...dept,
        departmentName,
        parentDepartmentId,
        managerUserId,
        description,
        isActive,
        updatedBy: updaterId,
        updatedAt: new Date(),
      };

      try {
        const auditLog = em.create(AuditLogEntity, {
          userId: updaterId,
          actionType: 'update',
          entityType: 'department',
          entityId: id,
          severity: AuditLogSeverity.INFO,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
          oldValueJson: before,
          newValueJson: {
            departmentName,
            parentDepartmentId,
            managerUserId,
            description,
            isActive,
          },
        });
        await em.save(AuditLogEntity, auditLog);
      } catch (auditError) {
        this.logger.error(
          'Failed to save audit log for department update ' +
            id +
            ': ' +
            (auditError as Error).message,
        );
      }
    });

    return this.toResponse(updatedDept!);
  }

  /**
   * Kiểm tra đặt `candidateParentId` làm cha của `currentId` có tạo chu trình không —
   * duyệt ngược lên từ `candidateParentId`; nếu gặp lại `currentId` thì `candidateParentId`
   * đang là hậu duệ của `currentId` → sẽ tạo chu trình nếu chấp nhận.
   */
  private async wouldCreateCycle(
    em: any,
    currentId: string,
    candidateParentId: string,
  ): Promise<boolean> {
    let cursor: string | null = candidateParentId;
    while (cursor) {
      if (cursor === currentId) return true;
      const dept: { parentDepartmentId: string | null } | null =
        await em.findOne(DepartmentEntity, {
          where: { id: cursor },
          select: ['id', 'parentDepartmentId'],
        });
      if (!dept) break;
      cursor = dept.parentDepartmentId;
    }
    return false;
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

  /**
   * Liệt kê phòng ban (đọc) — phục vụ dropdown FE.
   * Lọc: search (theo departmentName/departmentCode), parentId (phòng ban cha).
   * Phân trang page/limit (mặc định 1/20, limit ≤100). Loại bỏ bản ghi soft-deleted.
   */
  async listDepartments(
    query: ListDepartmentsQueryDto,
  ): Promise<{ data: DepartmentResponseDto[]; meta: PaginationMeta }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const search = query.search?.trim();

    const repo = this.dataSource.getRepository(DepartmentEntity);
    const base: Record<string, unknown> = { deletedAt: IsNull() };
    if (query.parentId) {
      base.parentDepartmentId = query.parentId;
    }

    // search → OR trên departmentName / departmentCode (ILIKE, không phân biệt hoa thường).
    const where = search
      ? [
          { ...base, departmentName: ILike(`%${search}%`) },
          { ...base, departmentCode: ILike(`%${search}%`) },
        ]
      : base;

    const [rows, total] = await repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((dept) => this.toResponse(dept)),
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  /**
   * ACCT-DEPT-MEMBERS-001 — Liệt kê nhân viên trực thuộc TRỰC TIẾP 1 phòng ban
   * (không đệ quy phòng ban con). Chỉ trả người employment_status ∈ {active, probation}
   * và account_status='active'. Không phân trang (phục vụ UX "chọn cả phòng ban").
   * Dùng để FE nạp nhanh vào participantUserIds khi đặt lịch họp — KHÔNG tính
   * xung đột lịch ở đây (dùng POST /scheduling/participant-conflicts/check sẵn có).
   */
  async listDepartmentMembers(
    departmentId: string,
  ): Promise<DepartmentMemberItemDto[]> {
    const department = await this.dataSource
      .getRepository(DepartmentEntity)
      .findOne({ where: { id: departmentId, deletedAt: IsNull() } });

    if (!department) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy phòng ban',
        error: { code: 'DEPARTMENT_NOT_FOUND', details: { departmentId } },
      });
    }

    const users = await this.dataSource.getRepository(UserEntity).find({
      where: {
        departmentId,
        deletedAt: IsNull(),
        accountStatus: AccountStatus.ACTIVE,
        employmentStatus: In([
          EmploymentStatus.ACTIVE,
          EmploymentStatus.PROBATION,
        ]),
      },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        avatarUrl: true,
        positionTitle: true,
        employmentStatus: true,
      },
    });

    const items: DepartmentMemberItemDto[] = users.map((u) => ({
      id: u.id,
      employeeCode: u.employeeCode,
      fullName: u.fullName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      avatarUrl: u.avatarUrl,
      positionTitle: u.positionTitle,
      employmentStatus: u.employmentStatus,
      isDepartmentManager: u.id === department.managerUserId,
    }));

    // Trưởng phòng lên đầu, sau đó theo tên (FR-006) — không dựa vào ORDER BY của
    // query trên vì manager_user_id thuộc bảng departments, không phải users.
    items.sort((a, b) => {
      if (a.isDepartmentManager !== b.isDepartmentManager) {
        return a.isDepartmentManager ? -1 : 1;
      }
      return a.fullName.localeCompare(b.fullName);
    });

    return items;
  }

  /** Map DepartmentEntity → DepartmentResponseDto (dùng chung cho list). */
  private toResponse(dept: DepartmentEntity): DepartmentResponseDto {
    return {
      id: dept.id,
      departmentCode: dept.departmentCode,
      departmentName: dept.departmentName,
      parentDepartmentId: dept.parentDepartmentId,
      managerUserId: dept.managerUserId,
      description: dept.description,
      isActive: dept.isActive,
      createdAt: dept.createdAt,
      updatedAt: dept.updatedAt,
    };
  }
}
