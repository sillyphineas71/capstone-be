/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';
import { GateAccessLogService } from './gate-access-log.service.js';

describe('GateAccessLogService (GAL-001 / UC-107)', () => {
  let service: GateAccessLogService;
  let repo: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    repo = { createQueryBuilder: jest.fn(() => qb) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GateAccessLogService,
        { provide: getRepositoryToken(GateAccessLogEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(GateAccessLogService);
  });

  const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });
  // Gộp mọi chuỗi SQL đã truyền vào where/andWhere để soát từ khoá.
  const allSql = () =>
    [...qb.where.mock.calls, ...qb.andWhere.mock.calls]
      .map((c) => String(c[0]))
      .join(' | ');
  const findAndWhere = (frag: string) =>
    qb.andWhere.mock.calls.find((c: any[]) => String(c[0]).includes(frag));

  // ⭐ Chốt chặn append-only: KHÔNG deletedAt trên gal, VÀ cố ý không lọc z/u.deletedAt.
  it('KHÔNG có "deleted" ở bất kỳ where/andWhere nào (cả 2 method, phủ gal/z/u)', async () => {
    await service.listForUser('u1', q());
    await service.listAll(q());
    expect(allSql().toLowerCase()).not.toContain('deleted');
  });

  describe('listForUser', () => {
    it('fold cứng userId + join zone, KHÔNG join user', async () => {
      await service.listForUser('u1', q());
      expect(qb.where).toHaveBeenCalledWith('gal.userId = :userId', {
        userId: 'u1',
      });
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.zone', 'z');
      const joinedUser = qb.leftJoinAndSelect.mock.calls.some(
        (c: any[]) => c[0] === 'gal.user',
      );
      expect(joinedUser).toBe(false);
    });

    it('filter from/to/direction/zone_id → andWhere bound param', async () => {
      await service.listForUser(
        'u1',
        q({
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-31T00:00:00Z',
          direction: 'enter',
          zoneId: 'z9',
        }),
      );
      expect(findAndWhere('gal.accessTime >= :from')[1]).toEqual({
        from: '2026-07-01T00:00:00Z',
      });
      expect(findAndWhere('gal.accessTime <= :to')[1]).toEqual({
        to: '2026-07-31T00:00:00Z',
      });
      expect(findAndWhere('gal.direction = :direction')[1]).toEqual({
        direction: 'enter',
      });
      expect(findAndWhere('gal.zoneId = :zoneId')[1]).toEqual({ zoneId: 'z9' });
    });

    it('filter vắng mặt KHÔNG lọt: chỉ gửi direction → không andWhere from/to/zone_id', async () => {
      await service.listForUser('u1', q({ direction: 'enter' }));
      expect(findAndWhere('gal.accessTime')).toBeUndefined();
      expect(findAndWhere('gal.zoneId')).toBeUndefined();
    });

    it('sort accessTime DESC + skip/take + meta', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 'l1' }], 25]);
      const r = await service.listForUser('u1', q({ page: 2, limit: 10 }));
      expect(qb.orderBy).toHaveBeenCalledWith('gal.accessTime', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(r.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    });

    it('list rỗng → items:[], meta.total=0, totalPages=0 (KHÔNG throw)', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      const r = await service.listForUser('u1', q());
      expect(r.items).toEqual([]);
      expect(r.meta.total).toBe(0);
      expect(r.meta.totalPages).toBe(0);
    });

    it('page/limit vắng mặt → default 1/20 (nhánh ?? )', async () => {
      const r = await service.listForUser('u1', {} as never);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(r.meta.page).toBe(1);
      expect(r.meta.limit).toBe(20);
    });
  });

  describe('listAll (admin)', () => {
    it('KHÔNG fold userId + LUÔN join zone và user', async () => {
      await service.listAll(q());
      // Không có where/andWhere userId khi client không gửi user_id.
      expect(findAndWhere('gal.userId')).toBeUndefined();
      expect(qb.where).not.toHaveBeenCalled();
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.zone', 'z');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('gal.user', 'u');
    });

    it('user_id exact → andWhere gal.userId = :uid', async () => {
      await service.listAll(q({ userId: 'u9' }));
      expect(findAndWhere('gal.userId = :uid')[1]).toEqual({ uid: 'u9' });
    });

    it('plate normalize trước so exact: "29a-123" → {plate:"29A123"}', async () => {
      await service.listAll(q({ plate: '29a-123' }));
      const call = findAndWhere('gal.plateNumber = :plate');
      expect(call[1]).toEqual({ plate: '29A123' });
    });

    it('search + filter KẾT HỢP: plate + from + user_id → cả 3 andWhere gắn', async () => {
      await service.listAll(
        q({ plate: '29A', from: '2026-07-01T00:00:00Z', userId: 'u9' }),
      );
      expect(findAndWhere('gal.plateNumber = :plate')).toBeDefined();
      expect(findAndWhere('gal.accessTime >= :from')).toBeDefined();
      expect(findAndWhere('gal.userId = :uid')).toBeDefined();
    });

    it('sort accessTime DESC + meta đúng', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ id: 'l1' }], 5]);
      const r = await service.listAll(q({ page: 1, limit: 20 }));
      expect(qb.orderBy).toHaveBeenCalledWith('gal.accessTime', 'DESC');
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 5, totalPages: 1 });
    });

    it('page/limit vắng mặt → default 1/20 (nhánh ?? )', async () => {
      const r = await service.listAll({} as never);
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(r.meta.limit).toBe(20);
    });

    it('to filter đơn lẻ → andWhere gal.accessTime <= :to', async () => {
      await service.listAll(q({ to: '2026-07-31T00:00:00Z' }));
      expect(findAndWhere('gal.accessTime <= :to')[1]).toEqual({
        to: '2026-07-31T00:00:00Z',
      });
    });
  });
});
