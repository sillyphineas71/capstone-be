/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { IotDevicesService } from './iot-devices.service.js';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IotAuditRepository } from '../repositories/iot-audit.repository.js';
import { IotDeviceEventsService } from './iot-device-events.service.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IoTDeviceType } from '../entities/iot-device.entity.js';
import { probeTcp } from '../utils/rtsp-probe.util.js';

jest.mock('../utils/rtsp-probe.util.js', () => ({
  probeTcp: jest.fn(),
}));
const probeTcpMock = probeTcp as jest.MockedFunction<typeof probeTcp>;

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
        find: jest.fn(),
        query: jest.fn(),
      } as any,
    };

    probeTcpMock.mockReset();

    auditRepoMock = {
      logDeviceCreation: jest.fn(),
      logAssignRoom: jest.fn(),
      logDeviceUpdate: jest.fn(),
      logDeviceStatusChange: jest.fn(),
      logConfigureRtsp: jest.fn(),
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
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, def?: unknown) => def) },
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

  describe('configureRtsp (IOT-015 credential encrypt)', () => {
    const OLD_KEY = process.env.RTSP_CRED_KEY;
    beforeAll(() => {
      process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    });
    afterAll(() => {
      process.env.RTSP_CRED_KEY = OLD_KEY;
    });

    const rtspDto = (over: any = {}) => ({
      rtsp_protocol: 'rtsp',
      rtsp_host: '10.0.0.5',
      rtsp_port: 554,
      rtsp_path: '/live',
      ...over,
    });

    it('rtsp_password → lưu rtsp_password_encrypted (KHÔNG plaintext) + configured=true', async () => {
      const device: any = {
        id: 'dev-1',
        deviceType: IoTDeviceType.IP_CAMERA,
        roomId: 'room-1',
        metadataJson: {},
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_e: unknown, obj: any) => obj,
      );

      await service.configureRtsp(
        'user-1',
        'dev-1',
        rtspDto({ rtsp_password: 'super-secret' }) as any,
      );

      const cfg = device.metadataJson.rtsp_config;
      expect(cfg.rtsp_password_configured).toBe(true);
      expect(typeof cfg.rtsp_password_encrypted).toBe('string');
      // KHÔNG lưu plaintext
      expect(JSON.stringify(device.metadataJson)).not.toContain('super-secret');
      expect(cfg.rtsp_password_encrypted).not.toContain('super-secret');
    });

    it('không gửi rtsp_password → carry-over encrypted + flag cũ', async () => {
      const device: any = {
        id: 'dev-1',
        deviceType: IoTDeviceType.IP_CAMERA,
        roomId: 'room-1',
        metadataJson: {
          rtsp_config: {
            rtsp_password_encrypted: 'OLD_BLOB_BASE64',
            rtsp_password_configured: true,
          },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_e: unknown, obj: any) => obj,
      );

      await service.configureRtsp('user-1', 'dev-1', rtspDto() as any);

      const cfg = device.metadataJson.rtsp_config;
      expect(cfg.rtsp_password_encrypted).toBe('OLD_BLOB_BASE64');
      expect(cfg.rtsp_password_configured).toBe(true);
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

  describe('detectOfflineDevices', () => {
    const cam = (over: any) => ({
      id: 'c1',
      deviceType: IoTDeviceType.IP_CAMERA,
      status: 'online',
      streamUrl: 'rtsp://10.0.0.1:554/live',
      ipAddress: null,
      ...over,
    });

    it('online->offline: transition + audit auto_offline', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online' }),
      ]);
      probeTcpMock.mockResolvedValue('offline');

      const r = await service.detectOfflineDevices('actor-1');

      expect(r.checked).toBe(1);
      expect(r.offline_count).toBe(1);
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({
          action: 'auto_offline',
          oldStatus: 'online',
          newStatus: 'offline',
          userId: 'actor-1',
        }),
      );
      expect(r.transitions).toEqual([
        { id: 'c1', from: 'online', to: 'offline' },
      ]);
    });

    it('offline->online: audit auto_online', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'offline' }),
      ]);
      probeTcpMock.mockResolvedValue('online');

      const r = await service.detectOfflineDevices(null);

      expect(r.online_count).toBe(1);
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({ action: 'auto_online', userId: null }),
      );
      expect(r.transitions[0]).toEqual({ id: 'c1', from: 'offline', to: 'online' });
    });

    it('idempotent: same status -> no transaction/audit/transition', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online' }),
      ]);
      probeTcpMock.mockResolvedValue('online');

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(1);
      expect(r.online_count).toBe(1);
      expect(r.transitions).toEqual([]);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).not.toHaveBeenCalled();
    });

    it('skip no-address camera (not counted in checked)', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online', streamUrl: null, ipAddress: null }),
      ]);

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(0);
      expect(probeTcpMock).not.toHaveBeenCalled();
    });

    it('fallback ip_address:554 when no stream_url', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online', streamUrl: null, ipAddress: '10.0.0.9' }),
      ]);
      probeTcpMock.mockResolvedValue('online');

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(1);
      expect(probeTcpMock).toHaveBeenCalledWith('10.0.0.9', 554, 3000);
    });

    it('resilience: one transition DB error does not break the run', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online' }),
        cam({ id: 'c2', status: 'online' }),
      ]);
      probeTcpMock.mockResolvedValue('offline');
      // c1 save fails, c2 succeeds
      queryRunnerMock.manager.save
        .mockRejectedValueOnce(new Error('DB fail'))
        .mockResolvedValueOnce({});

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(2);
      expect(r.offline_count).toBe(2);
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(r.transitions).toHaveLength(1); // chỉ c2 thành công
    });
  });
});
