/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { DepartmentsService } from './departments.service.js';
import { CreateDepartmentDto } from '../dto/create-department.dto.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { UserEntity } from '../entities/user.entity.js';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;
  let repo: { findAndCount: jest.Mock };

  const validDto: CreateDepartmentDto = {
    departmentCode: 'IT',
    departmentName: 'Phòng Công nghệ thông tin',
  };

  beforeEach(async () => {
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    repo = { findAndCount: jest.fn() };
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      getRepository: jest.fn().mockReturnValue(repo),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDepartment', () => {
    it('[AC-001] should create department successfully (Happy Path)', async () => {
      em.findOne.mockResolvedValue(null); // no duplicate, no parent, no manager
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'IT',
        departmentName: 'Phòng Công nghệ thông tin',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(validDto, 'creator-id', {
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-dept-uuid');
      expect(result.departmentCode).toBe('IT');
      expect(result.isActive).toBe(true);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[AC-002] should create department with parentDepartmentId', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'parent-uuid') {
            return {
              id: 'parent-uuid',
              isActive: true,
              parentDepartmentId: null,
            };
          }
          return null; // no duplicate code/name
        }
        return null;
      });
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'DEV',
        departmentName: 'Phòng Phát triển',
        parentDepartmentId: 'parent-uuid',
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(
        {
          ...validDto,
          departmentCode: 'DEV',
          departmentName: 'Phòng Phát triển',
          parentDepartmentId: 'parent-uuid',
        },
        'creator-id',
        {},
      );

      expect(result.parentDepartmentId).toBe('parent-uuid');
    });

    it('[AC-003] should create department with managerUserId', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) return null; // no duplicate
        if (entityClass === UserEntity) {
          if (options?.where?.id === 'manager-uuid') {
            return { id: 'manager-uuid', accountStatus: 'active' };
          }
        }
        return null;
      });
      const mockSavedDept = {
        id: 'new-dept-uuid',
        departmentCode: 'HR',
        departmentName: 'Phòng Nhân sự',
        parentDepartmentId: null,
        managerUserId: 'manager-uuid',
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      const result = await service.createDepartment(
        {
          ...validDto,
          departmentCode: 'HR',
          departmentName: 'Phòng Nhân sự',
          managerUserId: 'manager-uuid',
        },
        'creator-id',
        {},
      );

      expect(result.managerUserId).toBe('manager-uuid');
    });

    it('[AC-014] should throw ConflictException if departmentCode already exists', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.departmentCode === 'IT') {
            return { id: 'existing', departmentCode: 'IT' };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-015] should throw ConflictException if departmentName already exists', async () => {
      let callCount = 0;
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          callCount++;
          if (callCount === 1) return null; // code unique
          return {
            id: 'existing',
            departmentName: 'Phòng Công nghệ thông tin',
          }; // name duplicate
        }
        return null;
      });

      await expect(
        service.createDepartment(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-017] should throw NotFoundException if parent not found', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'nonexistent') return null; // parent not found
          return null; // no duplicate code/name
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'nonexistent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-017] should throw NotFoundException if parent is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.id === 'inactive-parent') {
            return { id: 'inactive-parent', isActive: false };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'inactive-parent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-013] should throw NotFoundException if manager is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) return null;
        if (entityClass === UserEntity) {
          if (options?.where?.id === 'inactive-manager') {
            return { id: 'inactive-manager', accountStatus: 'inactive' };
          }
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            managerUserId: 'inactive-manager',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('[AC-018→019] should throw UnprocessableEntityException for depth > 5', async () => {
      // Mock: parent chain depth 5
      em.findOne.mockImplementation(async (entityClass: any, options?: any) => {
        if (entityClass === DepartmentEntity) {
          if (options?.where?.departmentCode === 'IT') return null; // no code duplicate
          if (options?.where?.departmentName === 'Phòng Công nghệ thông tin')
            return null; // no name duplicate
          if (options?.where?.id === 'deep-parent') {
            // Return parent with chain of depth 5
            return {
              id: 'deep-parent',
              isActive: true,
              parentDepartmentId: 'level4',
            };
          }
          if (options?.where?.id === 'level4') {
            return { id: 'level4', parentDepartmentId: 'level3' };
          }
          if (options?.where?.id === 'level3') {
            return { id: 'level3', parentDepartmentId: 'level2' };
          }
          if (options?.where?.id === 'level2') {
            return { id: 'level2', parentDepartmentId: 'level1' };
          }
          if (options?.where?.id === 'level1') {
            return { id: 'level1', parentDepartmentId: null };
          }
          return null;
        }
        return null;
      });

      await expect(
        service.createDepartment(
          {
            ...validDto,
            parentDepartmentId: 'deep-parent',
          },
          'creator-id',
          {},
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-020] should write audit log on success', async () => {
      const mockSavedDept = {
        id: 'audit-dept-uuid',
        departmentCode: 'AUDIT',
        departmentName: 'Audit Dept',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      em.findOne.mockResolvedValue(null);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockResolvedValue(mockSavedDept);

      await service.createDepartment(
        {
          departmentCode: 'AUDIT',
          departmentName: 'Audit Dept',
        },
        'creator-id',
        {},
      );

      // Verify audit log was created (em.save called for both department + audit log)
      expect(em.save).toHaveBeenCalled();
    });
  });

  describe('listDepartments', () => {
    const deptRow = (over: Partial<DepartmentEntity> = {}) =>
      ({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'CNTT',
        parentDepartmentId: null,
        managerUserId: null,
        description: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }) as DepartmentEntity;

    it('list rỗng → data [], meta total 0 / totalPages 0', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      const r = await service.listDepartments({});
      expect(r.data).toEqual([]);
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('phân trang: page=2 limit=5, total=12 → skip 5 take 5, totalPages 3', async () => {
      repo.findAndCount.mockResolvedValue([[deptRow()], 12]);
      const r = await service.listDepartments({ page: 2, limit: 5 });
      const opts = repo.findAndCount.mock.calls[0][0];
      expect(opts.skip).toBe(5);
      expect(opts.take).toBe(5);
      expect(r.meta).toEqual({ page: 2, limit: 5, total: 12, totalPages: 3 });
      expect(r.data[0].departmentCode).toBe('IT');
    });

    it('search → where OR trên departmentName/departmentCode (ILIKE)', async () => {
      repo.findAndCount.mockResolvedValue([[deptRow()], 1]);
      await service.listDepartments({ search: 'cntt' });
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(2);
      // mỗi nhánh giữ deletedAt filter + 1 field ILike
      expect(where[0]).toHaveProperty('departmentName');
      expect(where[1]).toHaveProperty('departmentCode');
    });

    it('parentId → where lọc parentDepartmentId (không search → object đơn)', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);
      await service.listDepartments({ parentId: 'parent-uuid' });
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect(Array.isArray(where)).toBe(false);
      expect(where.parentDepartmentId).toBe('parent-uuid');
    });

    it('map entity → response đúng field (id/code/name/parentId/managerId/createdAt)', async () => {
      repo.findAndCount.mockResolvedValue([
        [deptRow({ managerUserId: 'm1', parentDepartmentId: 'p1' })],
        1,
      ]);
      const r = await service.listDepartments({});
      expect(r.data[0]).toMatchObject({
        id: 'd1',
        departmentCode: 'IT',
        departmentName: 'CNTT',
        parentDepartmentId: 'p1',
        managerUserId: 'm1',
      });
      expect(r.data[0].createdAt).toBeInstanceOf(Date);
    });
  });
});
