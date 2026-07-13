import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { CreateEquipmentDto } from '../dto/create-equipment.dto.js';

/**
 * UC-61 — EquipmentService.create: uniqueness, trạng thái khởi tạo, audit fail-separate.
 */
describe('EquipmentService.create (UC-61)', () => {
  const userId = 'user-1';
  const ip = '127.0.0.1';

  function baseDto(
    overrides: Partial<CreateEquipmentDto> = {},
  ): CreateEquipmentDto {
    return {
      equipmentName: 'May chieu Epson',
      equipmentType: EquipmentType.DISPLAY,
      equipmentCode: 'EQP-001',
      ...overrides,
    };
  }

  /**
   * setup:
   *  - existingBy: quyết định findOne trả existing theo field nào ('serial' | 'code' | null)
   *  - auditFails: transaction audit (lần 2) reject
   */
  function setup(opts: {
    existingBy?: 'serial' | 'code' | null;
    auditFails?: boolean;
  }) {
    const findOne = jest.fn((arg: { where: Record<string, unknown> }) => {
      const where = arg.where;
      if (opts.existingBy === 'serial' && 'serialNumber' in where) {
        return Promise.resolve({ id: 'dup-serial' });
      }
      if (opts.existingBy === 'code' && 'equipmentCode' in where) {
        return Promise.resolve({ id: 'dup-code' });
      }
      return Promise.resolve(null);
    });

    const fakeEm = {
      create: jest.fn((_entity: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_entity: unknown, obj: Record<string, unknown>) =>
        Promise.resolve({
          ...obj,
          id: 'eq-uuid-1',
          createdAt: new Date('2026-07-13T00:00:00Z'),
        }),
      ),
    };

    let call = 0;
    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) => {
      call += 1;
      // lần 1 = tạo thiết bị; lần 2 = audit
      if (call === 2 && opts.auditFails) {
        return Promise.reject(new Error('audit db down'));
      }
      return Promise.resolve(cb(fakeEm));
    });

    const repo = {
      findOne,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;
    const dataSource = {
      transaction,
    } as unknown as import('typeorm').DataSource;

    const service = new EquipmentService(repo, dataSource);
    return { service, findOne, fakeEm, transaction };
  }

  it('[S1] create hop le (khong healthStatus) → assetStatus=available, healthStatus=unknown, tra id', async () => {
    const { service } = setup({ existingBy: null });
    const res = await service.create(baseDto(), userId, ip);
    expect(res.id).toBe('eq-uuid-1');
    expect(res.assetStatus).toBe(AssetStatus.AVAILABLE);
    expect(res.healthStatus).toBe(HealthStatus.UNKNOWN);
    expect(res.currentRoomId).toBeNull();
  });

  it('[S2] healthStatus=healthy trong DTO → luu healthy (override)', async () => {
    const { service } = setup({ existingBy: null });
    const res = await service.create(
      baseDto({ healthStatus: HealthStatus.HEALTHY }),
      userId,
      ip,
    );
    expect(res.healthStatus).toBe(HealthStatus.HEALTHY);
  });

  it('[S3] serial trung → 409 EQUIPMENT_SERIAL_ALREADY_EXISTS', async () => {
    const { service } = setup({ existingBy: 'serial' });
    await expect(
      service.create(baseDto({ serialNumber: 'SN-123' }), userId, ip),
    ).rejects.toThrow(ConflictException);
  });

  it('[S4] equipmentCode trung → 409 EQUIPMENT_CODE_ALREADY_EXISTS', async () => {
    const { service } = setup({ existingBy: 'code' });
    await expect(service.create(baseDto(), userId, ip)).rejects.toThrow(
      ConflictException,
    );
  });

  it('[S5] serialNumber null → KHONG check serial (chi 1 findOne cho code), create OK', async () => {
    const { service, findOne } = setup({ existingBy: null });
    const res = await service.create(baseDto(), userId, ip);
    expect(res.id).toBe('eq-uuid-1');
    // chi goi findOne 1 lan (cho equipmentCode), khong goi cho serial
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0][0].where).toHaveProperty('equipmentCode');
  });

  it('[S6] normalize equipmentCode uppercase+trim truoc khi luu', async () => {
    const { service, fakeEm } = setup({ existingBy: null });
    await service.create(baseDto({ equipmentCode: '  eqp-abc  ' }), userId, ip);
    const savedArg = fakeEm.create.mock.calls[0][1] as {
      equipmentCode: string;
    };
    expect(savedArg.equipmentCode).toBe('EQP-ABC');
  });

  it('[S7] audit fail-separate → create van resolve (khong throw)', async () => {
    const { service, transaction } = setup({
      existingBy: null,
      auditFails: true,
    });
    const res = await service.create(baseDto(), userId, ip);
    expect(res.id).toBe('eq-uuid-1');
    // transaction goi 2 lan: tao + audit (audit reject nhung khong lam hong create)
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('[S8] assetStatus luon available (server cung) + audit entityType=equipment', async () => {
    const { service, fakeEm } = setup({ existingBy: null });
    await service.create(baseDto(), userId, ip);
    // tim call create cho AuditLogEntity
    const auditCall = fakeEm.create.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    );
    expect(auditCall).toBeDefined();
    const auditObj = auditCall![1] as {
      actionType: string;
      entityType: string;
      newValueJson: { assetStatus: string };
    };
    expect(auditObj.actionType).toBe('create');
    expect(auditObj.entityType).toBe('equipment');
    expect(auditObj.newValueJson.assetStatus).toBe(AssetStatus.AVAILABLE);
  });

  it('[S9] purchaseDate tuong lai → 422 INVALID_PURCHASE_DATE', async () => {
    const { service } = setup({ existingBy: null });
    await expect(
      service.create(baseDto({ purchaseDate: '2999-01-01' }), userId, ip),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
