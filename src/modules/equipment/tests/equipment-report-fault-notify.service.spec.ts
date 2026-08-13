import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

describe('EquipmentService.reportFault Notify Phase D (EQUIP-FAULT-LIFECYCLE-001)', () => {
  const equipmentId = 'eq-100';
  const userId = 'user-reporter';
  const ip = '127.0.0.1';

  function makeEquipment(
    overrides: Partial<EquipmentEntity> = {},
  ): EquipmentEntity {
    return {
      id: equipmentId,
      equipmentCode: 'EQP-100',
      equipmentName: 'May chieu phong hop A',
      equipmentType: EquipmentType.DISPLAY,
      serialNumber: null,
      brand: null,
      model: null,
      purchaseDate: null,
      assetStatus: AssetStatus.ASSIGNED,
      healthStatus: HealthStatus.UNKNOWN,
      currentRoomId: 'room-a',
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
    adminUserIds?: string[];
    notifyRejects?: boolean;
  }) {
    const equipment =
      opts.equipment === undefined ? makeEquipment() : opts.equipment;
    const adminUserIds = opts.adminUserIds ?? ['admin-1', 'admin-2'];

    const findOneRepo = jest.fn().mockResolvedValue(equipment);
    const roomFindOne = jest
      .fn()
      .mockResolvedValue({ id: 'room-a', roomName: 'Phong A' });

    const fakeEm = {
      create: jest.fn((_e: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_e: unknown, obj: Record<string, unknown>) =>
        Promise.resolve(obj),
      ),
    };

    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) =>
      Promise.resolve(cb(fakeEm)),
    );

    const query = jest
      .fn()
      .mockResolvedValue(adminUserIds.map((id) => ({ id })));

    const repo = {
      findOne: findOneRepo,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;

    const roomRepo = {
      findOne: roomFindOne,
    };

    const dataSource = {
      transaction,
      manager: { query },
      getRepository: jest.fn((entity: unknown) => {
        if (entity === EquipmentEntity) return repo;
        return roomRepo;
      }),
    } as unknown as import('typeorm').DataSource;

    const createNotification = opts.notifyRejects
      ? jest.fn().mockRejectedValue(new Error('Notification service down'))
      : jest.fn().mockResolvedValue({ id: 'notif-1' });

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
      dataSource,
      notificationsService,
      createNotification,
      query,
    };
  }

  it('[N1] reportFault thành công → gọi createNotification với EQUIPMENT_FAULT_REPORTED cho SYSTEM_ADMIN', async () => {
    const { service, createNotification } = setup({});
    const res = await service.reportFault(
      equipmentId,
      { healthStatus: HealthStatus.FAULTY, issueNote: 'Hu mic' },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: NotificationType.EQUIPMENT_FAULT_REPORTED,
        channel: NotificationChannel.IN_APP,
        recipientUserIds: ['admin-1', 'admin-2'],
        priority: NotificationPriority.HIGH,
        relatedEntityId: equipmentId,
      }),
    );
  });

  it('[N2] resolveSystemAdminIds trả [] → createNotification vẫn được gọi với [] không throw', async () => {
    const { service, createNotification } = setup({ adminUserIds: [] });
    const res = await service.reportFault(
      equipmentId,
      { healthStatus: HealthStatus.FAULTY, issueNote: 'Loi cap' },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: NotificationType.EQUIPMENT_FAULT_REPORTED,
        recipientUserIds: [],
      }),
    );
  });

  it('[N3] createNotification throw error → reportFault vẫn trả 200 (fail-separate)', async () => {
    const { service } = setup({ notifyRejects: true });
    const res = await service.reportFault(
      equipmentId,
      { healthStatus: HealthStatus.FAULTY, issueNote: 'Chay no' },
      userId,
      ip,
    );

    expect(res.healthStatus).toBe(HealthStatus.FAULTY);
  });
});
