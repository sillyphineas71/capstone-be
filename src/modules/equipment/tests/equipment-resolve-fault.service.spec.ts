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

describe('EquipmentService.resolveFault (EQUIP-FAULT-LIFECYCLE-001)', () => {
  const equipmentId = 'eq-300';
  const userId = 'sysadmin-2';
  const reporterUserId = 'employee-reporter-2';
  const ip = '127.0.0.1';

  function makeEquipment(
    overrides: Partial<EquipmentEntity> = {},
  ): EquipmentEntity {
    return {
      id: equipmentId,
      equipmentCode: 'EQP-300',
      equipmentName: 'Micro khong dây',
      equipmentType: EquipmentType.MICROPHONE,
      serialNumber: null,
      brand: null,
      model: null,
      purchaseDate: null,
      assetStatus: AssetStatus.MAINTENANCE,
      healthStatus: HealthStatus.FAULTY,
      currentRoomId: 'room-300',
      assignedBy: null,
      assignedAt: null,
      installedAt: null,
      assignmentNote: null,
      iotDeviceId: null,
      lastMaintenanceAt: null,
      lastIssueReportedAt: new Date('2026-08-01T00:00:00Z'),
      lastIssueNote: 'Hu pin',
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
        if (opts.auditFails && _e === AuditLogEntity) {
          return Promise.reject(new Error('Audit DB fail'));
        }
        return Promise.resolve(obj);
      }),
    };

    let txCall = 0;
    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) => {
      txCall += 1;
      if (txCall === 2 && opts.auditFails) {
        return Promise.reject(new Error('Audit DB fail'));
      }
      return Promise.resolve(cb(fakeEm));
    });

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
      : jest.fn().mockResolvedValue({ id: 'notif-3' });

    const notificationsService = {
      createNotification,
    } as unknown as NotificationsService;

    const service = new EquipmentService(
      repo,
      dataSource,
      notificationsService,
    );

    return {
      service,
      repo,
      auditRepo,
      fakeEm,
      createNotification,
      equipment,
      transaction,
    };
  }

  it('[RF1] healthStatus=healthy → OK, data.healthStatus=healthy, lastMaintenanceAt set, lastIssueNote giữ nguyên', async () => {
    const { service, equipment } = setup({});
    const oldReportedAt = equipment?.lastIssueReportedAt;
    const oldReportNote = equipment?.lastIssueNote;

    const res = await service.resolveFault(
      equipmentId,
      { healthStatus: HealthStatus.HEALTHY, resolutionNote: 'Thay pin moi' },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.HEALTHY);
    expect(equipment?.lastMaintenanceAt).toBeInstanceOf(Date);
    expect(equipment?.lastIssueReportedAt).toBe(oldReportedAt);
    expect(equipment?.lastIssueNote).toBe(oldReportNote);
  });

  it('[RF2] healthStatus=warning → OK', async () => {
    const { service } = setup({});
    const res = await service.resolveFault(
      equipmentId,
      {
        healthStatus: HealthStatus.WARNING,
        resolutionNote: 'Sửa tạm, cần theo dõi thêm',
      },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.WARNING);
  });

  it('[RF3] assetStatus=active + room assigned → ASSIGNED', async () => {
    const { service } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.MAINTENANCE,
        currentRoomId: 'room-300',
      }),
    });

    const res = await service.resolveFault(
      equipmentId,
      {
        healthStatus: HealthStatus.HEALTHY,
        assetStatus: 'active',
        resolutionNote: 'Suong roi',
      },
      userId,
      ip,
    );

    expect(res.assetStatus).toBe(AssetStatus.ASSIGNED);
  });

  it('[RF3b] assetStatus=retired → RETIRED', async () => {
    const { service } = setup({});
    const res = await service.resolveFault(
      equipmentId,
      {
        healthStatus: HealthStatus.HEALTHY,
        assetStatus: 'retired',
        resolutionNote: 'Thanh ly luon',
      },
      userId,
      ip,
    );

    expect(res.assetStatus).toBe(AssetStatus.RETIRED);
  });

  it('[RF4] thiết bị healthy → 409 EQUIPMENT_NO_ACTIVE_FAULT', async () => {
    const { service } = setup({
      equipment: makeEquipment({ healthStatus: HealthStatus.HEALTHY }),
    });

    await expect(
      service.resolveFault(
        equipmentId,
        { healthStatus: HealthStatus.HEALTHY, resolutionNote: 'X' },
        userId,
        ip,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('[RF5] thiết bị không tồn tại → 404 EQUIPMENT_NOT_FOUND', async () => {
    const { service } = setup({ equipment: null });

    await expect(
      service.resolveFault(
        equipmentId,
        { healthStatus: HealthStatus.HEALTHY, resolutionNote: 'X' },
        userId,
        ip,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('[RF6] audit fail-separate → entity vẫn lưu, resolveFault vẫn thành công', async () => {
    const { service } = setup({ auditFails: true });

    const res = await service.resolveFault(
      equipmentId,
      { healthStatus: HealthStatus.HEALTHY, resolutionNote: 'Da sua' },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.HEALTHY);
  });

  it('[RF7] notify reporter đúng EQUIPMENT_FAULT_RESOLVED', async () => {
    const { service, createNotification } = setup({
      lastReportUser: reporterUserId,
    });

    await service.resolveFault(
      equipmentId,
      { healthStatus: HealthStatus.HEALTHY, resolutionNote: 'Da thay cap' },
      userId,
      ip,
    );

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: NotificationType.EQUIPMENT_FAULT_RESOLVED,
        recipientUserIds: [reporterUserId],
      }),
    );
  });
});
