/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { IotDevicesService } from './iot-devices.service.js';
import { DataSource } from 'typeorm';
import { IotAuditRepository } from '../repositories/iot-audit.repository.js';
import { IotDeviceEventsService } from './iot-device-events.service.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IoTDeviceType } from '../entities/iot-device.entity.js';

describe('IotDevicesService', () => {
  let service: IotDevicesService;
  let dataSourceMock: any;
  let auditRepoMock: any;
  let queryRunnerMock: any; // Keep as any for deep mocking

  beforeEach(async () => {
    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        create: jest.fn((entity, dto) => dto),
        save: jest.fn((entity, obj) => ({ ...obj, id: 'test-id' })),
      },
      query: jest.fn(),
    };

    dataSourceMock = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunnerMock) as any,
      getRepository: jest.fn(),
      manager: {
        findOne: jest.fn(),
        query: jest.fn(),
      } as any,
    };

    auditRepoMock = {
      logDeviceCreation: jest.fn(),
      logAssignRoom: jest.fn(),
      logDeviceUpdate: jest.fn(),
      logDeviceStatusChange: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IotDevicesService,
        { provide: DataSource, useValue: dataSourceMock as DataSource },
        {
          provide: IotAuditRepository,
          useValue: auditRepoMock as IotAuditRepository,
        },
        {
          provide: IotDeviceEventsService,
          useValue: { storeRawEvent: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<IotDevicesService>(IotDevicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a device successfully (happy path)', async () => {
    queryRunnerMock.manager.findOne.mockResolvedValue(null);

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-001',
      deviceType: IoTDeviceType.ROOM_CAMERA,
    };

    const result = await service.create('user-id', dto);

    expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
    expect(queryRunnerMock.manager.save).toHaveBeenCalled();
    expect(auditRepoMock.logDeviceCreation).toHaveBeenCalledWith(
      queryRunnerMock.manager,
      {
        userId: 'user-id',
        deviceId: 'test-id',
        metadataJson: null,
      },
    );
    expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    expect(result.id).toBe('test-id');
    expect(result.status).toBe('offline');
  });

  it('should throw ConflictException if deviceCode exists', async () => {
    queryRunnerMock.manager.findOne.mockImplementation(
      async (entity, options) => {
        if (options.where.deviceCode === 'CAM-001') return { id: 'existing' };
        return null;
      },
    );

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-001',
      deviceType: IoTDeviceType.ROOM_CAMERA,
    };

    await expect(service.create('user-id', dto)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create('user-id', dto)).rejects.toThrow(
      'Device code already exists in the system.',
    );
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
  });

  it('should throw ConflictException if macAddress exists', async () => {
    queryRunnerMock.manager.findOne.mockImplementation(
      async (entity, options) => {
        if (options.where.macAddress === 'AA:BB:CC') return { id: 'existing' };
        return null;
      },
    );

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-002',
      deviceType: IoTDeviceType.ROOM_CAMERA,
      macAddress: 'AA:BB:CC',
    };

    await expect(service.create('user-id', dto)).rejects.toThrow(
      ConflictException,
    );
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
  });

  describe('assignRoom', () => {
    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if device type is invalid', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.MICROPHONE,
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if device is already assigned to a DIFFERENT room', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: 'room-2',
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return 200 OK (return early) if device is assigned to the SAME room', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.assignRoom('user-id', 'dev-1', {
        roomId: 'room-1',
      });
      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled(); // No DB update
    });

    it('should throw NotFoundException if room is not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([]);

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if room is not active', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: false },
      ]);

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully assign room, log audit and commit transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: true },
      ]);

      queryRunnerMock.manager.save.mockResolvedValue({
        ...device,
        roomId: 'room-1',
      });

      const result = await service.assignRoom('user-id', 'dev-1', {
        roomId: 'room-1',
      });

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logAssignRoom).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.roomId).toBe('room-1');
    });

    it('should rollback transaction if audit log fails', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: true },
      ]);

      queryRunnerMock.manager.save.mockResolvedValue({
        ...device,
        roomId: 'room-1',
      });

      (auditRepoMock.logAssignRoom as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('T1 happy: updates fields, saves and logs audit', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
        status: 'online',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'New Cam',
        ipAddress: '192.168.1.2',
      });

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).toHaveBeenCalledTimes(1);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.deviceName).toBe('New Cam');
      expect(result.ipAddress).toBe('192.168.1.2');
    });

    it('T2 idempotent: same values => no transaction, no audit', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Same Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'Same Cam',
      });

      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).not.toHaveBeenCalled();
    });

    it('T3 mac conflict: existing mac on another device => ConflictException', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Cam',
        macAddress: 'AA:AA:AA:AA:AA:AA',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockImplementation(
        async (_entity: unknown, options: any) => {
          if (options.where.macAddress !== undefined) return { id: 'other' };
          return device;
        },
      );

      await expect(
        service.update('user-id', 'dev-1', {
          macAddress: 'BB:BB:BB:BB:BB:BB',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update('user-id', 'dev-1', {
          macAddress: 'BB:BB:BB:BB:BB:BB',
        }),
      ).rejects.toThrow('MAC address already exists in the system.');
    });

    it('T4 not found: device missing => NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('user-id', 'dev-1', { deviceName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('T5 empty body: no allowlist field => BadRequestException NO_UPDATABLE_FIELDS', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceName: 'Cam',
      });
      await expect(service.update('user-id', 'dev-1', {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('user-id', 'dev-1', {})).rejects.toThrow(
        'No updatable fields were provided.',
      );
    });

    it('T6 set null: clears a connection field (ip_address -> null)', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        ipAddress: null,
      });

      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).toHaveBeenCalledTimes(1);
      expect(result.ipAddress).toBeNull();
    });

    it('T7 does not touch status/health/last_seen', async () => {
      const lastSeen = new Date('2026-06-15T00:00:00Z');
      const device = {
        id: 'dev-1',
        deviceName: 'Old',
        ipAddress: null,
        macAddress: null,
        networkIdentifier: null,
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: lastSeen,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'New',
      });

      expect(result.status).toBe('online');
      expect(result.healthStatus).toBe('healthy');
      expect(result.lastSeenAt).toBe(lastSeen);
    });

    it('T8 rollback: audit failure rolls back transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old',
        ipAddress: null,
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );
      (auditRepoMock.logDeviceUpdate as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.update('user-id', 'dev-1', { deviceName: 'New' }),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('T1 happy: online -> disabled, saves and logs status change', async () => {
      const device = {
        id: 'dev-1',
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: new Date('2026-06-15T00:00:00Z'),
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.disable('user-id', 'dev-1');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledTimes(1);
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({
          action: 'disable',
          oldStatus: 'online',
          newStatus: 'disabled',
        }),
      );
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe('disabled');
    });

    it('T2 idempotent: already disabled -> no-op, no transaction/audit', async () => {
      const device = { id: 'dev-1', status: 'disabled' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.disable('user-id', 'dev-1');

      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).not.toHaveBeenCalled();
    });

    it('T3 not found: device missing -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.disable('user-id', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('T4 does not touch health/last_seen/room', async () => {
      const lastSeen = new Date('2026-06-15T00:00:00Z');
      const device = {
        id: 'dev-1',
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: lastSeen,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.disable('user-id', 'dev-1');

      expect(result.status).toBe('disabled');
      expect(result.healthStatus).toBe('healthy');
      expect(result.lastSeenAt).toBe(lastSeen);
      expect(result.roomId).toBe('room-1');
    });

    it('T5 rollback: audit failure rolls back transaction', async () => {
      const device = { id: 'dev-1', status: 'online' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );
      (auditRepoMock.logDeviceStatusChange as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(service.disable('user-id', 'dev-1')).rejects.toThrow(
        'DB Error',
      );
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    it('T6 happy: disabled -> offline, saves and logs status change', async () => {
      const device = { id: 'dev-1', status: 'disabled' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.enable('user-id', 'dev-1');

      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({
          action: 'enable',
          oldStatus: 'disabled',
          newStatus: 'offline',
        }),
      );
      expect(result.status).toBe('offline');
    });

    it('T7 no-op when not disabled: online stays online, no audit', async () => {
      const device = { id: 'dev-1', status: 'online' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.enable('user-id', 'dev-1');

      expect(result).toEqual(device);
      expect(result.status).toBe('online');
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).not.toHaveBeenCalled();
    });

    it('T8 not found: device missing -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.enable('user-id', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    let qbMock: any;

    beforeEach(() => {
      qbMock = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(),
      };
      (dataSourceMock.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qbMock),
      });
    });

    it('default: no filter, sort createdAt DESC, skip 0 take 20, meta correct', async () => {
      qbMock.getManyAndCount.mockResolvedValue([
        [{ id: 'd1', status: 'online' }],
        42,
      ]);

      const result = await service.findAll({ page: 1, limit: 20 } as any);

      expect(qbMock.andWhere).not.toHaveBeenCalled();
      expect(qbMock.orderBy).toHaveBeenCalledWith('d.createdAt', 'DESC');
      expect(qbMock.skip).toHaveBeenCalledWith(0);
      expect(qbMock.take).toHaveBeenCalledWith(20);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 42,
        totalPages: 3,
      });
      expect(result.items).toHaveLength(1);
    });

    it('status filter: andWhere status', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 20, status: 'disabled' } as any);
      expect(qbMock.andWhere).toHaveBeenCalledWith('d.status = :status', {
        status: 'disabled',
      });
    });

    it('search: bound ILIKE on deviceName/deviceCode', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 20, search: 'ipcam' } as any);
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)',
        { s: '%ipcam%' },
      );
    });

    it('page 2: skip (2-1)*20 = 20', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 42]);
      await service.findAll({ page: 2, limit: 20 } as any);
      expect(qbMock.skip).toHaveBeenCalledWith(20);
    });

    it('empty: total 0 -> totalPages 0', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      const result = await service.findAll({ page: 1, limit: 20 } as any);
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('happy: returns mapped response', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'd1',
        deviceName: 'Cam',
        deviceCode: 'C1',
        status: 'online',
      });
      const result = await service.findOne('d1');
      expect(result.id).toBe('d1');
      expect(result.device_name).toBe('Cam');
    });

    it('404: not found -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
