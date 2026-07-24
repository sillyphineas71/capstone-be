/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';
import { PersonControlListService } from './person-control-list.service.js';

describe('PersonControlListService (PWL-001 / UC-125)', () => {
  let service: PersonControlListService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'p1', ...x })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonControlListService,
        {
          provide: getRepositoryToken(PersonControlListEntity),
          useValue: repo,
        },
      ],
    }).compile();
    service = module.get(PersonControlListService);
  });

  describe('create', () => {
    it('userId + displayName → save đúng field, listType/priority mặc định, createdBy từ actor', async () => {
      const r = await service.create(
        { userId: 'user-1', displayName: 'Nguyễn Văn A' },
        'admin1',
      );
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.userId).toBe('user-1');
      expect(saved.listType).toBe('watchlist');
      expect(saved.priority).toBe('medium');
      expect(saved.active).toBe(true);
      expect(saved.createdBy).toBe('admin1');
      expect(r.id).toBe('p1');
    });

    it('chỉ có displayName (không userId/faceProfileId) → tạo tự do, KHÔNG pre-check gì (spec §2.7)', async () => {
      await service.create({ displayName: 'Người lạ X' }, 'admin1');
      expect(repo.findOne).not.toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('R1: trùng (userId, listType) còn sống → 409 PERSON_ALREADY_IN_CONTROL_LIST, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'old' }); // userId conflict check
      await expect(
        service.create({ userId: 'user-1', displayName: 'A' } as any, 'admin1'),
      ).rejects.toMatchObject({
        response: { code: 'PERSON_ALREADY_IN_CONTROL_LIST' },
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('R2: trùng (faceProfileId, listType) còn sống → 409, KHÔNG save', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'old' }); // faceProfileId conflict check
      await expect(
        service.create(
          { faceProfileId: 'face-1', displayName: 'A' } as any,
          'admin1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('R2 §2.6 crux: có CẢ userId lẫn faceProfileId → kiểm CẢ 2 điều kiện dedup ĐỘC LẬP (2 lần findOne)', async () => {
      await service.create(
        { userId: 'user-1', faceProfileId: 'face-1', displayName: 'A' },
        'admin1',
      );
      expect(repo.findOne).toHaveBeenCalledTimes(2);
      const userWhere = repo.findOne.mock.calls[0][0].where;
      const faceWhere = repo.findOne.mock.calls[1][0].where;
      expect(userWhere.userId).toBe('user-1');
      expect(faceWhere.faceProfileId).toBe('face-1');
    });

    it('userId trùng nhưng faceProfileId khác → VẪN 409 (userId conflict đủ để chặn)', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'old' }); // userId conflict found first
      await expect(
        service.create(
          {
            userId: 'user-1',
            faceProfileId: 'face-new',
            displayName: 'A',
          } as any,
          'admin1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('R3 crux: save ném 23505 (race) → safety-net 409', async () => {
      repo.save.mockRejectedValue({ driverError: { code: '23505' } });
      await expect(
        service.create({ userId: 'user-1', displayName: 'A' } as any, 'admin1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(
        service.create({ displayName: 'A' } as any, 'admin1'),
      ).rejects.toBe(boom);
    });
  });

  describe('list', () => {
    it('filter active=false PHẢI áp dụng (không bị bỏ sót do truthy-check sai)', async () => {
      await service.list({ page: 1, limit: 20, active: false });
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('active' in where).toBe(true);
      expect(where.active).toBe(false);
    });

    it('meta đúng: total=25 limit=20 → totalPages=2', async () => {
      const rows = Array.from({ length: 20 }, () => ({ id: 'x' }));
      repo.findAndCount.mockResolvedValue([rows, 25]);
      const r = await service.list({ page: 1, limit: 20 });
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
    });
  });

  describe('findOne', () => {
    it('không tồn tại → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const owned = () => ({
      id: 'p1',
      userId: 'user-1',
      faceProfileId: null,
      listType: 'watchlist',
      displayName: 'A',
      photoMediaFileId: null,
      reason: null,
      priority: 'medium',
      active: true,
    });

    it('không đổi userId/faceProfileId/listType → KHÔNG re-check conflict', async () => {
      repo.findOne.mockResolvedValueOnce(owned());
      await service.update('p1', { priority: 'high' } as any);
      expect(repo.findOne).toHaveBeenCalledTimes(1); // chỉ load entity
    });

    it('đổi userId → re-check conflict (loại trừ chính id)', async () => {
      repo.findOne.mockResolvedValueOnce(owned()).mockResolvedValueOnce(null);
      await service.update('p1', { userId: 'user-2' });
      expect(repo.findOne).toHaveBeenCalledTimes(2);
      const conflictWhere = repo.findOne.mock.calls[1][0].where;
      expect(conflictWhere.userId).toBe('user-2');
    });
  });

  describe('remove', () => {
    it('tồn tại → softDelete', async () => {
      repo.findOne.mockResolvedValue({ id: 'p1' });
      await service.remove('p1');
      expect(repo.softDelete).toHaveBeenCalledWith('p1');
    });

    it('không tồn tại → 404, KHÔNG softDelete', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
