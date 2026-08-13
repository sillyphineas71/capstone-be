import { ConflictException, NotFoundException } from '@nestjs/common';
import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { NotificationType } from '../../notifications/entities/notification.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

describe('EquipmentService.confirmFault (EQUIP-FAULT-LIFECYCLE-001)', () => {
  const equipmentId = 'eq-200';
  const userId = 'sysadmin-1';
  const reporterUserId = 'employee-reporter';
  const ip = '127.0.0.1';

  function makeEquipment(
    overrides: Partial<EquipmentEntity> = {},
  ): EquipmentEntity {
    return {
      id: equipmentId,
      equipmentCode: 'EQP-200',
      equipmentName: 'Loa thong minh',
      equipmentType: EquipmentType.SPEAKER,
      serialNumber: null,
      brand: null,
      model: null,
      purchaseDate: null,
      assetStatus: AssetStatus.MAINTENANCE,
      healthStatus: HealthStatus.FAULTY,
      currentRoomId: null,
      assignedBy: null,
      assignedAt: null,
      installedAt: null,
      assignmentNote: null,
      iotDeviceId: null,
      lastMaintenanceAt: null,
      lastIssueReportedAt: new Date('2026-08-10T00:00:00Z'),
      lastIssueNote: 'Re loa',
      specificationJson: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
      updatedAt: new Date('2026-07-13T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    } as unknown as EquipmentEntity;
  }

  function setup(opts: {
    equipment?: EquipmentEntity | null;
    lastReportUser?: string | null;
    auditFails?: boolean;
    notifyFails?: boolean;
  }) {
    const equipment =
      opts.equipment === undefined ? makeEquipment() : opts.equipment;

    const findOneEquipment = jest.fn().mockResolvedValue(equipment);

    const auditLogFind = jest
      .fn()
      .mockResolvedValue(
        opts.lastReportUser ? [{ userId: opts.lastReportUser }] : [],
      );

    const fakeEm = {
      create: jest.fn((_e: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_e: unknown, obj: Record<string, unknown>) => {
        if (opts.auditFails) return Promise.reject(new Error('Audit DB fail'));
        return Promise.resolve(obj);
      }),
    };

    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) =>
      Promise.resolve(cb(fakeEm)),
    );

    const repo = {
      findOne: findOneEquipment,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;

    const auditRepo = {
      find: auditLogFind,
    };

    const dataSource = {
      transaction,
      getRepository: jest.fn((entity: unknown) => {
        if (entity === EquipmentEntity) return repo;
        if (entity === AuditLogEntity) return auditRepo;
        return repo;
      }),
    } as unknown as import('typeorm').DataSource;

    const createNotification = opts.notifyFails
      ? jest.fn().mockRejectedValue(new Error('Notification failed'))
      : jest.fn().mockResolvedValue({ id: 'notif-2' });

    const notificationsService = {
      createNotification,
    } as unknown as NotificationsService;

    const service = new EquipmentService(
      repo,
      dataSource,
      notificationsService,
    );

    return { service, repo, auditRepo, fakeEm, createNotification, equipment };
  }

  it('[CF1] thiết bị faulty → confirm OK, audit_logs ghi actionType=confirm, healthStatus KHÔNG đổi', async () => {
    const { service, fakeEm, equipment } = setup({});
    const res = await service.confirmFault(
      equipmentId,
      { confirmationNote: 'Da kiem tra la that' },
      userId,
      ip,
    );

    expect(res.equipmentId).toBe(equipmentId);
    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
    expect(res.confirmedBy).toBe(userId);
    expect(res.confirmedAt).toBeInstanceOf(Date);
    expect(equipment?.healthStatus).toBe(HealthStatus.FAULTY);

    const savedAudit = fakeEm.save.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    );
    expect(savedAudit).toBeDefined();
    expect(savedAudit?.[1]).toEqual(
      expect.objectContaining({
        actionType: 'confirm',
        entityType: 'equipment',
        entityId: equipmentId,
      }),
    );
  });

  it('[CF2] thiết bị healthy → 409 EQUIPMENT_NO_ACTIVE_FAULT', async () => {
    const { service } = setup({
      equipment: makeEquipment({ healthStatus: HealthStatus.HEALTHY }),
    });

    await expect(
      service.confirmFault(equipmentId, {}, userId, ip),
    ).rejects.toThrow(ConflictException);
  });

  it('[CF3] thiết bị không tồn tại → 404 EQUIPMENT_NOT_FOUND', async () => {
    const { service } = setup({ equipment: null });

    await expect(
      service.confirmFault(equipmentId, {}, userId, ip),
    ).rejects.toThrow(NotFoundException);
  });

  it('[CF4] tìm được reporter khác actor → createNotification(EQUIPMENT_FAULT_CONFIRMED) recipientUserIds: [reporterId]', async () => {
    const { service, createNotification } = setup({
      lastReportUser: reporterUserId,
    });

    await service.confirmFault(equipmentId, {}, userId, ip);

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: NotificationType.EQUIPMENT_FAULT_CONFIRMED,
        recipientUserIds: [reporterUserId],
      }),
    );
  });

  it('[CF5] reporter === actor hiện tại → KHÔNG gọi notify', async () => {
    const { service, createNotification } = setup({
      lastReportUser: userId, // actor tự confirm lỗi mình báo
    });

    await service.confirmFault(equipmentId, {}, userId, ip);

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('[CF6] không tìm được reporter (audit rỗng) → không lỗi, không gọi notify', async () => {
    const { service, createNotification } = setup({
      lastReportUser: null,
    });

    const res = await service.confirmFault(equipmentId, {}, userId, ip);

    expect(res.equipmentId).toBe(equipmentId);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
