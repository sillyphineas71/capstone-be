import { NotFoundException } from '@nestjs/common';
import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

/**
 * UC-63 — EquipmentService.deleteEquipment: soft-delete + gỡ tham chiếu phòng + audit ATOMIC.
 * File test RIÊNG, không đụng test UC-61/62.
 */
describe('EquipmentService.deleteEquipment (UC-63)', () => {
  const equipmentId = 'eq-1';
  const userId = 'user-1';
  const ip = '127.0.0.1';

  function makeEquipment(
    overrides: Partial<EquipmentEntity> = {},
  ): EquipmentEntity {
    return {
      id: equipmentId,
      equipmentCode: 'EQP-001',
      equipmentName: 'May chieu',
      equipmentType: EquipmentType.DISPLAY,
      serialNumber: 'SN-1',
      brand: null,
      model: null,
      purchaseDate: null,
      assetStatus: AssetStatus.AVAILABLE,
      healthStatus: HealthStatus.UNKNOWN,
      currentRoomId: null,
      assignedBy: null,
      assignedAt: null,
      installedAt: null,
      assignmentNote: null,
      iotDeviceId: null,
      lastMaintenanceAt: null,
      lastIssueReportedAt: null,
      lastIssueNote: null,
      specificationJson: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
      updatedAt: new Date('2026-07-13T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    } as unknown as EquipmentEntity;
  }

  function setup(opts: {
    equipment?: EquipmentEntity | null;
    auditFails?: boolean;
  }) {
    const equipment =
      opts.equipment === undefined ? makeEquipment() : opts.equipment;

    const findOne = jest.fn().mockResolvedValue(equipment);

    const fakeTem = {
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_e: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_e: unknown, obj: Record<string, unknown>) =>
        opts.auditFails
          ? Promise.reject(new Error('audit db down'))
          : Promise.resolve(obj),
      ),
      // các API hard-delete — phải KHÔNG được gọi (C8)
      delete: jest.fn(),
      remove: jest.fn(),
    };

    const transaction = jest.fn((cb: (em: typeof fakeTem) => unknown) =>
      cb(fakeTem),
    );

    const repo = {
      findOne,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;
    const dataSource = {
      transaction,
    } as unknown as import('typeorm').DataSource;

    const notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-noop' }),
    } as unknown as NotificationsService;
    const service = new EquipmentService(
      repo,
      dataSource,
      notificationsService,
    );
    return { service, findOne, fakeTem, transaction };
  }

  it('[S1] xoa OK → softDelete goi; update set currentRoomId=null, assetStatus=RETIRED, assigned_* clear', async () => {
    const { service, fakeTem } = setup({});
    await service.deleteEquipment(equipmentId, userId, ip);

    expect(fakeTem.softDelete).toHaveBeenCalledWith(
      EquipmentEntity,
      equipmentId,
    );
    const updateArg = (fakeTem.update.mock.calls[0] as unknown[])[2] as Record<
      string,
      unknown
    >;
    expect(updateArg.currentRoomId).toBeNull();
    expect(updateArg.assetStatus).toBe(AssetStatus.RETIRED);
    expect(updateArg.assignedBy).toBeNull();
    expect(updateArg.assignedAt).toBeNull();
    expect(updateArg.installedAt).toBeNull();
    expect(updateArg.assignmentNote).toBeNull();
  });

  it('[S2] thiet bi assigned → xoa OK + go ref (KHONG chan — C3)', async () => {
    const { service, fakeTem } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.ASSIGNED,
        currentRoomId: 'room-1',
      }),
    });
    await service.deleteEquipment(equipmentId, userId, ip);
    expect(fakeTem.softDelete).toHaveBeenCalled();
    const updateArg = (fakeTem.update.mock.calls[0] as unknown[])[2] as Record<
      string,
      unknown
    >;
    expect(updateArg.currentRoomId).toBeNull();
    expect(updateArg.assetStatus).toBe(AssetStatus.RETIRED);
  });

  it('[S3] khong ton tai → 404 EQUIPMENT_NOT_FOUND, KHONG goi transaction', async () => {
    const { service, transaction } = setup({ equipment: null });
    await expect(
      service.deleteEquipment(equipmentId, userId, ip),
    ).rejects.toThrow(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('[S4] idempotent — da soft-delete (findOne deletedAt:IsNull → null) → 404', async () => {
    const { service } = setup({ equipment: null });
    await expect(
      service.deleteEquipment(equipmentId, userId, ip),
    ).rejects.toThrow(NotFoundException);
  });

  it('[S5] soft-delete KHONG hard-delete — softDelete goi; delete/remove KHONG goi (C8)', async () => {
    const { service, fakeTem } = setup({});
    await service.deleteEquipment(equipmentId, userId, ip);
    expect(fakeTem.softDelete).toHaveBeenCalledTimes(1);
    expect(fakeTem.delete).not.toHaveBeenCalled();
    expect(fakeTem.remove).not.toHaveBeenCalled();
  });

  it('[S6] audit ATOMIC trong transaction — actionType=delete, oldValueJson, WARNING', async () => {
    const { service, fakeTem } = setup({});
    await service.deleteEquipment(equipmentId, userId, ip);
    const auditArg = fakeTem.create.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    );
    expect(auditArg).toBeDefined();
    const audit = auditArg![1] as {
      actionType: string;
      entityType: string;
      oldValueJson: Record<string, unknown>;
      severity: string;
    };
    expect(audit.actionType).toBe('delete');
    expect(audit.entityType).toBe('equipment');
    expect(audit.severity).toBe('warning');
    expect(audit.oldValueJson).toMatchObject({
      equipmentCode: 'EQP-001',
      assetStatus: AssetStatus.AVAILABLE,
    });
    // audit save phai goi TRONG transaction (cung fakeTem)
    expect(fakeTem.save).toHaveBeenCalledWith(
      AuditLogEntity,
      expect.anything(),
    );
  });

  it('[S7] audit fail → throw/rollback (KHAC fail-separate)', async () => {
    const { service } = setup({ auditFails: true });
    // transaction reject lan ra ngoai → deleteEquipment throw (KHONG nuot loi)
    await expect(
      service.deleteEquipment(equipmentId, userId, ip),
    ).rejects.toThrow('audit db down');
  });

  it('[S8] thu tu: update (go ref) goi TRUOC softDelete', async () => {
    const { service, fakeTem } = setup({});
    await service.deleteEquipment(equipmentId, userId, ip);
    const updateOrder = fakeTem.update.mock.invocationCallOrder[0];
    const softDeleteOrder = fakeTem.softDelete.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(softDeleteOrder);
  });
});
