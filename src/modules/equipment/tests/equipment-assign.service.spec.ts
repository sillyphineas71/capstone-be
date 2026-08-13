import { ConflictException, NotFoundException } from '@nestjs/common';
import { EquipmentService } from '../services/equipment.service.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import { RoomEntity, RoomStatus } from '../../rooms/entities/room.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { AssignEquipmentDto } from '../dto/assign-equipment.dto.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

/**
 * UC-65 — EquipmentService.assignToRoom: validate (equip 404→409→room 404→409)
 * → update 6 field → audit fail-separate. Đọc RoomEntity qua getRepository.
 * File test RIÊNG, không đụng test UC-61/62/63/64.
 */
describe('EquipmentService.assignToRoom (UC-65)', () => {
  const equipmentId = 'eq-1';
  const roomId = 'room-1';
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

  function makeRoom(overrides: Partial<RoomEntity> = {}): RoomEntity {
    return {
      id: roomId,
      isActive: true,
      currentStatus: RoomStatus.AVAILABLE,
      deletedAt: null,
      ...overrides,
    } as unknown as RoomEntity;
  }

  function dto(
    overrides: Partial<AssignEquipmentDto> = {},
  ): AssignEquipmentDto {
    return { roomId, ...overrides };
  }

  function setup(opts: {
    equipment?: EquipmentEntity | null;
    room?: RoomEntity | null;
    auditFails?: boolean;
  }) {
    const equipment =
      opts.equipment === undefined ? makeEquipment() : opts.equipment;
    const room = opts.room === undefined ? makeRoom() : opts.room;

    const equipmentFindOne = jest.fn().mockResolvedValue(equipment);
    const roomFindOne = jest.fn().mockResolvedValue(room);
    const getRepository = jest.fn(() => ({ findOne: roomFindOne }));

    const fakeEm = {
      create: jest.fn((_e: unknown, obj: Record<string, unknown>) => obj),
      save: jest.fn((_e: unknown, obj: Record<string, unknown>) =>
        Promise.resolve(obj),
      ),
    };

    let txCall = 0;
    const transaction = jest.fn((cb: (em: typeof fakeEm) => unknown) => {
      txCall += 1;
      if (txCall === 2 && opts.auditFails) {
        return Promise.reject(new Error('audit db down'));
      }
      return Promise.resolve(cb(fakeEm));
    });

    const repo = {
      findOne: equipmentFindOne,
    } as unknown as import('typeorm').Repository<EquipmentEntity>;
    const dataSource = {
      getRepository,
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
    return {
      service,
      equipmentFindOne,
      roomFindOne,
      getRepository,
      transaction,
      fakeEm,
      equipment,
    };
  }

  it('[S1] gan available → phong active OK: currentRoomId + assetStatus', async () => {
    const { service } = setup({});
    const res = await service.assignToRoom(equipmentId, dto(), userId, ip);
    expect(res.currentRoomId).toBe(roomId);
    expect(res.assetStatus).toBe(AssetStatus.ASSIGNED);
  });

  it('[S1b] set assignedBy/assignedAt/installedAt/assignmentNote', async () => {
    const { service, equipment } = setup({});
    await service.assignToRoom(
      equipmentId,
      dto({ assignmentNote: 'lap goc phong' }),
      userId,
      ip,
    );
    expect((equipment as EquipmentEntity).assignedBy).toBe(userId);
    expect((equipment as EquipmentEntity).assignedAt).toBeInstanceOf(Date);
    expect((equipment as EquipmentEntity).installedAt).toBeInstanceOf(Date);
    expect((equipment as EquipmentEntity).assignmentNote).toBe('lap goc phong');
  });

  it('[S2] equipment khong ton tai → 404, KHONG load room', async () => {
    const { service, getRepository } = setup({ equipment: null });
    await expect(
      service.assignToRoom(equipmentId, dto(), userId, ip),
    ).rejects.toThrow(NotFoundException);
    expect(getRepository).not.toHaveBeenCalled();
  });

  it('[S3] equipment retired/lost/maintenance → 409 EQUIPMENT_NOT_ASSIGNABLE', async () => {
    for (const status of [
      AssetStatus.RETIRED,
      AssetStatus.LOST,
      AssetStatus.MAINTENANCE,
    ]) {
      const { service } = setup({
        equipment: makeEquipment({ assetStatus: status }),
      });
      await expect(
        service.assignToRoom(equipmentId, dto(), userId, ip),
      ).rejects.toThrow(ConflictException);
    }
  });

  it('[S4] room khong ton tai → 404 ROOM_NOT_FOUND', async () => {
    const { service } = setup({ room: null });
    await expect(
      service.assignToRoom(equipmentId, dto(), userId, ip),
    ).rejects.toThrow(NotFoundException);
  });

  it('[S5] room isActive=false / currentStatus=inactive → 409 ROOM_NOT_ASSIGNABLE', async () => {
    const inactive = setup({ room: makeRoom({ isActive: false }) });
    await expect(
      inactive.service.assignToRoom(equipmentId, dto(), userId, ip),
    ).rejects.toThrow(ConflictException);

    const statusInactive = setup({
      room: makeRoom({ currentStatus: RoomStatus.INACTIVE }),
    });
    await expect(
      statusInactive.service.assignToRoom(equipmentId, dto(), userId, ip),
    ).rejects.toThrow(ConflictException);
  });

  it('[S6] re-assign phong khac → currentRoomId doi + assignedAt moi', async () => {
    const { service, equipment } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.ASSIGNED,
        currentRoomId: 'room-A',
      }),
    });
    const res = await service.assignToRoom(
      equipmentId,
      dto({ roomId: 'room-B' }),
      userId,
      ip,
    );
    expect(res.currentRoomId).toBe('room-B');
    expect((equipment as EquipmentEntity).assignedAt).toBeInstanceOf(Date);
  });

  it('[S7] gan dung phong dang o → cap nhat lai (khong loi)', async () => {
    const { service } = setup({
      equipment: makeEquipment({
        assetStatus: AssetStatus.ASSIGNED,
        currentRoomId: roomId,
      }),
    });
    const res = await service.assignToRoom(equipmentId, dto(), userId, ip);
    expect(res.currentRoomId).toBe(roomId);
    expect(res.assetStatus).toBe(AssetStatus.ASSIGNED);
  });

  it('[S8] installedAt mac dinh now khi khong truyen', async () => {
    const { service, equipment } = setup({});
    await service.assignToRoom(equipmentId, dto(), userId, ip);
    expect((equipment as EquipmentEntity).installedAt).toBeInstanceOf(Date);
  });

  it('[S9] audit fail-separate → assignToRoom van resolve (khong throw)', async () => {
    const { service, transaction } = setup({ auditFails: true });
    const res = await service.assignToRoom(equipmentId, dto(), userId, ip);
    expect(res.currentRoomId).toBe(roomId);
    // transaction goi 2 lan: Phase B (update) + Phase C (audit reject)
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('[S10] doc RoomEntity qua getRepository(RoomEntity) + audit update/INFO', async () => {
    const { service, getRepository, fakeEm } = setup({});
    await service.assignToRoom(equipmentId, dto(), userId, ip);
    expect(getRepository).toHaveBeenCalledWith(RoomEntity);

    const auditArg = fakeEm.create.mock.calls.find(
      (c) => c[0] === AuditLogEntity,
    );
    expect(auditArg).toBeDefined();
    const audit = auditArg![1] as {
      actionType: string;
      entityType: string;
      severity: string;
      newValueJson: { currentRoomId: string };
    };
    expect(audit.actionType).toBe('update');
    expect(audit.entityType).toBe('equipment');
    expect(audit.severity).toBe('info');
    expect(audit.newValueJson.currentRoomId).toBe(roomId);
  });
});
