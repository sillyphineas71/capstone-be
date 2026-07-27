/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { BadRequestException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service.js';
import { SystemConfigValueType } from '../entities/system-config.entity.js';
import { AuditLogsService } from './audit-logs.service.js';

describe('SystemConfigService (BE-09)', () => {
  let service: SystemConfigService;
  let dataSource: any;
  let repo: { find: jest.Mock };
  let qb: any;
  let em: any;
  let auditLogsService: jest.Mocked<AuditLogsService>;

  const row = (over: any = {}) => ({
    id: 'cfg-1',
    configKey: 'no_show_threshold_minutes',
    configValue: '10',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'no_show',
    description: 'x',
    versionNo: 1,
    isSensitive: false,
    isActive: true,
    updatedBy: null,
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    repo = { find: jest.fn() };

    qb = {
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };

    em = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn(),
      create: jest.fn((_entity: any, plain: any) => plain),
    };

    dataSource = {
      getRepository: jest.fn().mockReturnValue(repo),
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: any) => unknown) => cb(em)),
    };

    auditLogsService = {
      logAction: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    service = new SystemConfigService(dataSource, auditLogsService);
  });

  describe('list()', () => {
    it('chỉ trả key nằm trong allowlist, is_active=true', async () => {
      repo.find.mockResolvedValue([
        row({ configKey: 'no_show_threshold_minutes' }),
        row({ configKey: 'not_in_allowlist_key', id: 'cfg-2' }),
      ]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('no_show_threshold_minutes');
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('mask value khi is_sensitive=true', async () => {
      repo.find.mockResolvedValue([
        row({ configKey: 'no_show_threshold_minutes', isSensitive: true }),
      ]);
      const result = await service.list();
      expect(result[0].value).toBeNull();
    });

    it('không mask khi is_sensitive=false', async () => {
      repo.find.mockResolvedValue([
        row({ configKey: 'grace_minutes', configValue: '5' }),
      ]);
      const result = await service.list();
      expect(result[0].value).toBe('5');
    });
  });

  describe('upsert() — validation', () => {
    it('key ngoài allowlist → 400 CONFIG_KEY_NOT_ALLOWED', async () => {
      await expect(
        service.upsert('some_random_key', 'true', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('value sai kiểu cho key boolean → 400', async () => {
      await expect(
        service.upsert('is_auto_release_enabled', 'yes', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value không phải số cho key number → 400', async () => {
      await expect(
        service.upsert('no_show_threshold_minutes', 'abc', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value ngoài biên dưới (min) → 400', async () => {
      await expect(
        service.upsert('no_show_threshold_minutes', '0', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value ngoài biên trên (max) → 400', async () => {
      await expect(
        service.upsert('no_show_threshold_minutes', '999', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('value boolean hợp lệ (false) → không lỗi', async () => {
      qb.getMany.mockResolvedValue([]);
      em.save.mockResolvedValue(
        row({ configKey: 'is_auto_release_enabled', configValue: 'false' }),
      );
      const result = await service.upsert(
        'is_auto_release_enabled',
        'false',
        'admin-1',
      );
      expect(result.key).toBe('is_auto_release_enabled');
    });
  });

  describe('upsert() — key chưa có → INSERT', () => {
    it('tạo mới với version_no=1', async () => {
      qb.getMany.mockResolvedValue([]);
      em.save.mockImplementation((_e: any, plain: any) => ({
        ...plain,
        id: 'new-id',
        updatedAt: new Date(),
      }));

      const result = await service.upsert(
        'grace_minutes',
        '7',
        'admin-1',
      );

      expect(em.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          configKey: 'grace_minutes',
          configValue: '7',
          versionNo: 1,
        }),
      );
      expect(result.value).toBe('7');
    });
  });

  describe('upsert() — key đã có → UPDATE', () => {
    it('tăng version_no, cập nhật updated_by', async () => {
      const existing = row({ configKey: 'grace_minutes', versionNo: 3 });
      qb.getMany.mockResolvedValue([existing]);
      em.save.mockImplementation((_e: any, entity: any) => entity);

      const result = await service.upsert(
        'grace_minutes',
        '8',
        'admin-2',
      );

      expect(existing.versionNo).toBe(4);
      expect(existing.updatedBy).toBe('admin-2');
      expect(existing.configValue).toBe('8');
      expect(result.value).toBe('8');
    });

    it('KHÔNG dùng ON CONFLICT — SELECT FOR UPDATE qua setLock', async () => {
      qb.getMany.mockResolvedValue([row({ configKey: 'grace_minutes' })]);
      em.save.mockImplementation((_e: any, entity: any) => entity);

      await service.upsert('grace_minutes', '9', 'admin-1');

      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });
  });

  describe('upsert() — nhiều dòng trùng key (thiếu unique index)', () => {
    it('cập nhật dòng mới nhất theo updated_at, KHÔNG tạo thêm dòng', async () => {
      const older = row({
        id: 'old',
        configKey: 'grace_minutes',
        updatedAt: new Date('2026-01-01'),
      });
      const newer = row({
        id: 'newer',
        configKey: 'grace_minutes',
        updatedAt: new Date('2026-06-01'),
      });
      qb.getMany.mockResolvedValue([older, newer]);
      em.save.mockImplementation((_e: any, entity: any) => entity);

      await service.upsert('grace_minutes', '11', 'admin-1');

      expect(newer.configValue).toBe('11');
      expect(older.configValue).not.toBe('11');
      expect(em.create).not.toHaveBeenCalled();
    });
  });

  describe('upsert() — audit log', () => {
    it('ghi audit log với key/value đã đổi', async () => {
      qb.getMany.mockResolvedValue([]);
      em.save.mockImplementation((_e: any, plain: any) => ({
        ...plain,
        id: 'new-id',
        updatedAt: new Date(),
      }));

      await service.upsert('grace_minutes', '6', 'admin-1');

      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          actionType: 'system_config_update',
          entityType: 'system_configs',
          metadataJson: { key: 'grace_minutes', value: '6' },
        }),
      );
    });
  });
});
