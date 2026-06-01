/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { IotDevicesService } from './iot-devices.service';
import { DataSource } from 'typeorm';
import { IotAuditRepository } from '../repositories/iot-audit.repository';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { IotDeviceType } from '../entities/iot-device.entity';

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
      manager: {
        findOne: jest.fn(),
        query: jest.fn(),
      } as any,
    };

    auditRepoMock = {
      logDeviceCreation: jest.fn(),
      logAssignRoom: jest.fn(),
      logConfigureFaceServer: jest.fn(),
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
      deviceType: IotDeviceType.ROOM_CAMERA,
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
      deviceType: IotDeviceType.ROOM_CAMERA,
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
      deviceType: IotDeviceType.ROOM_CAMERA,
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
        deviceType: IotDeviceType.MICROPHONE,
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if device is already assigned to a DIFFERENT room', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.ROOM_CAMERA,
        roomId: 'room-2',
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return 200 OK (return early) if device is assigned to the SAME room', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.ROOM_CAMERA,
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
        deviceType: IotDeviceType.ROOM_CAMERA,
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
        deviceType: IotDeviceType.ROOM_CAMERA,
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
        deviceType: IotDeviceType.ROOM_CAMERA,
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
        deviceType: IotDeviceType.ROOM_CAMERA,
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

  describe('configureFaceServer', () => {
    const validDto = {
      callback_enabled: true,
      callback_protocol: 'http' as const,
      callback_base_url: 'http://localhost',
      allowed_source_ip: '127.0.0.1',
      heartbeat_path: '/heartbeat',
      verify_path: '/verify',
      stranger_path: '/stranger',
    };

    it('should configure successfully, generate token, and commit transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: 'room-1',
        metadataJson: { old_key: 'old_val' },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.configureFaceServer(
        'user-id',
        'dev-1',
        validDto,
      );

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logConfigureFaceServer).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.oneTimeCallbackToken).toBeDefined();
      expect(
        device.metadataJson.face_server_config.callback_token_hash,
      ).toBeDefined();
      expect(
        device.metadataJson.face_server_config.callback_token_last4,
      ).toBeDefined();
      expect(device.metadataJson.old_key).toBe('old_val');
    });

    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.configureFaceServer('user-id', 'dev-1', validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if invalid device type', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.ROOM_CAMERA,
        roomId: 'room-1',
      });
      await expect(
        service.configureFaceServer('user-id', 'dev-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if device not assigned to a room', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: null,
      });
      await expect(
        service.configureFaceServer('user-id', 'dev-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should default callback_enabled to true if not provided', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const dtoWithoutEnabled = { ...validDto };
      delete (dtoWithoutEnabled as any).callback_enabled;

      await service.configureFaceServer('user-id', 'dev-1', dtoWithoutEnabled);

      expect(device.metadataJson.face_server_config.callback_enabled).toBe(
        true,
      );
    });

    it('should replace old token hash with new one on re-config', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: 'room-1',
        metadataJson: {
          face_server_config: { callback_token_hash: 'old_hash' },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.configureFaceServer(
        'user-id',
        'dev-1',
        validDto,
      );

      expect(
        device.metadataJson.face_server_config.callback_token_hash,
      ).not.toBe('old_hash');
      expect(result.oneTimeCallbackToken).toBeDefined();
    });

    it('should rollback transaction if audit log fails', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);
      (auditRepoMock.logConfigureFaceServer as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.configureFaceServer('user-id', 'dev-1', validDto),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('configureRtsp', () => {
    const validDto = {
      rtsp_enabled: true,
      rtsp_protocol: 'rtsp' as const,
      rtsp_host: '192.168.1.50',
      rtsp_port: 554,
      rtsp_path: '/stream/1',
      rtsp_username: 'admin',
      rtsp_password: 'new_password',
      stream_profile: 'main',
    };

    it('should configure successfully, overwrite password, and commit transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
        metadataJson: { rtsp_config: { rtsp_password: 'old_password' } },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.configureRtsp('user-id', 'dev-1', validDto);

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logConfigureRtsp).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(device.metadataJson.rtsp_config.rtsp_password).toBe(
        'new_password',
      );
    });

    it('should keep old password if not provided', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
        metadataJson: { rtsp_config: { rtsp_password: 'old_password' } },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const dtoWithoutPassword = { ...validDto };
      delete (dtoWithoutPassword as any).rtsp_password;

      await service.configureRtsp('user-id', 'dev-1', dtoWithoutPassword);

      expect(device.metadataJson.rtsp_config.rtsp_password).toBe(
        'old_password',
      );
    });

    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.configureRtsp('user-id', 'dev-1', validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if invalid device type', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        roomId: 'room-1',
      });
      await expect(
        service.configureRtsp('user-id', 'dev-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if device not assigned to a room', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: null,
      });
      await expect(
        service.configureRtsp('user-id', 'dev-1', validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should rollback transaction if audit log fails', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);
      (auditRepoMock.logConfigureRtsp as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.configureRtsp('user-id', 'dev-1', validDto),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });
  describe('checkAvailability', () => {
    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.checkAvailability('user-id', 'dev-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if invalid device type', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IotDeviceType.MICROPHONE,
      });
      await expect(
        service.checkAvailability('user-id', 'dev-1'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.checkAvailability('user-id', 'dev-1'),
      ).rejects.toThrow(
        'This device type is not supported for availability check.',
      );
    });

    it('should mark door_face_terminal as available, online, healthy if heartbeat within 5 minutes', async () => {
      const lastSeenAt = new Date();
      lastSeenAt.setMinutes(lastSeenAt.getMinutes() - 2); // 2 minutes ago

      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        lastSeenAt,
        status: 'offline',
        healthStatus: 'unknown',
        metadataJson: { old_meta: 'val' },
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('online');
      expect(result.healthStatus).toBe('healthy');
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        true,
      );
      expect(result.metadataJson.last_availability_check.check_type).toBe(
        'heartbeat_status',
      );
      expect(result.metadataJson.last_availability_check.runtime_verified).toBe(
        true,
      );
      expect(
        result.metadataJson.last_availability_check.reason_code,
      ).toBeNull();
      expect(result.metadataJson.old_meta).toBe('val'); // Old meta preserved
      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('should mark door_face_terminal as unavailable, offline, unhealthy if heartbeat > 5 minutes', async () => {
      const lastSeenAt = new Date();
      lastSeenAt.setMinutes(lastSeenAt.getMinutes() - 10); // 10 minutes ago

      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        lastSeenAt,
        status: 'online',
        healthStatus: 'healthy',
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('offline');
      expect(result.healthStatus).toBe('unhealthy');
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.reason_code).toBe(
        'HEARTBEAT_STALE',
      );
      expect(result.metadataJson.last_availability_check.runtime_verified).toBe(
        true,
      );
    });

    it('should mark door_face_terminal as unavailable, offline, unknown if heartbeat not seen', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        lastSeenAt: null,
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('offline');
      expect(result.healthStatus).toBe('unknown');
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.reason_code).toBe(
        'HEARTBEAT_NOT_SEEN',
      );
      expect(result.metadataJson.last_availability_check.runtime_verified).toBe(
        false,
      );
    });

    it('should mark ip_room_camera as unavailable if missing room', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: null,
        status: 'offline',
        metadataJson: { rtsp_config: { rtsp_enabled: true } },
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('offline'); // Keep status
      expect(result.healthStatus).toBe('not_configured');
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.reason_code).toBe(
        'DEVICE_ROOM_ASSIGNMENT_REQUIRED',
      );
    });

    it('should mark ip_room_camera as unavailable if missing rtsp_config', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
        status: 'offline',
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('offline'); // Keep status
      expect(result.healthStatus).toBe('not_configured');
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.reason_code).toBe(
        'RTSP_CONFIG_MISSING',
      );
    });

    it('should mark ip_room_camera as unavailable if rtsp_enabled is false', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
        status: 'offline',
        metadataJson: { rtsp_config: { rtsp_enabled: false } },
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.metadataJson.last_availability_check.is_available).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.reason_code).toBe(
        'RTSP_DISABLED',
      );
    });

    it('should mark ip_room_camera as config-ready available if fully configured', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IotDeviceType.IP_ROOM_CAMERA,
        roomId: 'room-1',
        status: 'offline',
        metadataJson: {
          rtsp_config: {
            rtsp_enabled: true,
            rtsp_host: '1.1.1.1',
            rtsp_port: 554,
            rtsp_path: '/path',
          },
        },
      };

      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.checkAvailability('user-id', 'dev-1');

      expect(result.status).toBe('offline'); // Status NOT updated to online
      expect(result.healthStatus).toBe('unknown'); // Fallback for config_ready
      expect(result.metadataJson.last_availability_check.is_available).toBe(
        true,
      );
      expect(result.metadataJson.last_availability_check.runtime_verified).toBe(
        false,
      );
      expect(result.metadataJson.last_availability_check.check_type).toBe(
        'rtsp_config_readiness',
      );
      expect(
        result.metadataJson.last_availability_check.reason_code,
      ).toBeNull();
      expect(auditRepoMock.logConfigureFaceServer).not.toHaveBeenCalled();
      expect(auditRepoMock.logConfigureRtsp).not.toHaveBeenCalled();
    });
  });

  describe('receiveHeartbeat', () => {
    const validTokenHash = require('crypto')
      .createHash('sha256')
      .update('valid-token-123')
      .digest('hex');

    const makeDevice = (overrides: any = {}) => ({
      id: 'dev-1',
      deviceCode: 'FACE-001',
      deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
      status: 'offline',
      healthStatus: 'unknown',
      lastSeenAt: null,
      metadataJson: {
        face_server_config: {
          callback_enabled: true,
          callback_token_hash: validTokenHash,
          allowed_source_ip: null,
        },
        rtsp_config: { old_key: 'keep' },
      },
      ...overrides,
    });

    const makeInput = (overrides: any = {}) => ({
      headers: {},
      body: null,
      query: { device_code: 'FACE-001', callback_token: 'valid-token-123' },
      clientIp: '192.168.2.3',
      ...overrides,
    });

    it('should receive heartbeat via query params (GET scenario)', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(makeInput());

      expect(result.device_code).toBe('FACE-001');
      expect(result.status).toBe('online');
      expect(result.health_status).toBe('healthy');
      expect(result.last_seen_at).toBeDefined();
      expect(result.received_at).toBeDefined();
      expect(device.status).toBe('online');
      expect(device.healthStatus).toBe('healthy');
      expect(device.lastSeenAt).toBeDefined();
      expect(device.metadataJson.last_heartbeat).toBeDefined();
      expect(device.metadataJson.rtsp_config.old_key).toBe('keep'); // Old metadata preserved
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('should receive heartbeat via headers', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(
        makeInput({
          headers: {
            'x-device-code': 'FACE-001',
            'x-callback-token': 'valid-token-123',
          },
          query: {},
        }),
      );

      expect(result.status).toBe('online');
      expect(result.health_status).toBe('healthy');
    });

    it('should receive heartbeat via body JSON', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(
        makeInput({
          headers: {},
          body: {
            device_code: 'FACE-001',
            callback_token: 'valid-token-123',
            status: 'alive',
            timestamp: '2026-06-02T01:00:00.000Z',
          },
          query: {},
        }),
      );

      expect(result.status).toBe('online');
      expect(device.metadataJson.last_heartbeat.device_status).toBe('alive');
      expect(device.metadataJson.last_heartbeat.payload_timestamp).toBe(
        '2026-06-02T01:00:00.000Z',
      );
    });

    it('should succeed with empty body when query params are provided', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(makeInput({ body: null }));

      expect(result.status).toBe('online');
    });

    it('should throw BadRequestException if device_code is missing', async () => {
      await expect(
        service.receiveHeartbeat(
          makeInput({
            headers: {},
            body: null,
            query: { callback_token: 'valid-token-123' },
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.receiveHeartbeat(makeInput())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if device type is not door_face_terminal', async () => {
      const device = makeDevice({ deviceType: IotDeviceType.IP_ROOM_CAMERA });
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      await expect(service.receiveHeartbeat(makeInput())).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if callback not enabled', async () => {
      const device = makeDevice({
        metadataJson: {
          face_server_config: { callback_enabled: false },
        },
      });
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      await expect(service.receiveHeartbeat(makeInput())).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw UnauthorizedException if callback_token is missing', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      await expect(
        service.receiveHeartbeat(
          makeInput({ query: { device_code: 'FACE-001' } }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if callback_token is invalid', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      await expect(
        service.receiveHeartbeat(
          makeInput({
            query: { device_code: 'FACE-001', callback_token: 'wrong-token' },
          }),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ForbiddenException if source IP does not match', async () => {
      const device = makeDevice({
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: validTokenHash,
            allowed_source_ip: '10.0.0.1',
          },
        },
      });
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      await expect(
        service.receiveHeartbeat(makeInput({ clientIp: '192.168.2.3' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should skip IP check if allowed_source_ip is null', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(
        makeInput({ clientIp: '10.99.99.99' }),
      );

      expect(result.status).toBe('online');
    });

    it('should normalize ::ffff: IPv4-mapped address', async () => {
      const device = makeDevice({
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: validTokenHash,
            allowed_source_ip: '192.168.2.3',
          },
        },
      });
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(
        makeInput({ clientIp: '::ffff:192.168.2.3' }),
      );

      expect(result.status).toBe('online');
      expect(device.metadataJson.last_heartbeat.source_ip).toBe('192.168.2.3');
    });

    it('should mask sensitive fields in raw_payload_sample', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      await service.receiveHeartbeat(
        makeInput({
          body: {
            device_code: 'FACE-001',
            callback_token: 'valid-token-123',
            status: 'alive',
            some_secret: 'leak_me',
            nested_password: 'bad',
          },
          query: {},
          headers: {},
        }),
      );

      const sample = device.metadataJson.last_heartbeat.raw_payload_sample;
      expect(sample.callback_token).toBe('***'); // masked by maskSensitiveMetadata
      expect(sample.some_secret).toBe('***');
      expect(sample.nested_password).toBe('***');
      expect(sample.status).toBe('alive'); // non-sensitive kept
    });

    it('should preserve old metadata (face_server_config, rtsp_config, last_availability_check)', async () => {
      const device = makeDevice({
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: validTokenHash,
          },
          rtsp_config: { rtsp_host: '1.1.1.1' },
          last_availability_check: { is_available: true },
          vendor: 'Dahua',
        },
      });
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      await service.receiveHeartbeat(makeInput());

      expect(device.metadataJson.face_server_config).toBeDefined();
      expect(device.metadataJson.rtsp_config.rtsp_host).toBe('1.1.1.1');
      expect(device.metadataJson.last_availability_check.is_available).toBe(
        true,
      );
      expect(device.metadataJson.vendor).toBe('Dahua');
      expect(device.metadataJson.last_heartbeat).toBeDefined();
    });

    it('should not call audit repository', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      await service.receiveHeartbeat(makeInput());

      expect(auditRepoMock.logDeviceCreation).not.toHaveBeenCalled();
      expect(auditRepoMock.logAssignRoom).not.toHaveBeenCalled();
      expect(auditRepoMock.logConfigureFaceServer).not.toHaveBeenCalled();
      expect(auditRepoMock.logConfigureRtsp).not.toHaveBeenCalled();
    });

    it('should not return sensitive fields in response', async () => {
      const device = makeDevice();
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockResolvedValue(device);

      const result = await service.receiveHeartbeat(makeInput());

      expect(result).not.toHaveProperty('callback_token');
      expect(result).not.toHaveProperty('callback_token_hash');
      expect(result).not.toHaveProperty('rtsp_password');
      expect(result).not.toHaveProperty('metadata_json');
    });
  });
});
