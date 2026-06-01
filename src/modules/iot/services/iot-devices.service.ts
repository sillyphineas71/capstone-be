import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IotDevice } from '../entities/iot-device.entity';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto';
import { AssignRoomDto } from '../dto/assign-room.dto';
import { ConfigureFaceServerDto } from '../dto/configure-face-server.dto';
import { ConfigureRtspDto } from '../dto/configure-rtsp.dto';
import { IotAuditRepository } from '../repositories/iot-audit.repository';
import * as crypto from 'crypto';
import { IotDeviceType } from '../entities/iot-device.entity';

@Injectable()
export class IotDevicesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly iotAuditRepository: IotAuditRepository,
  ) {}

  async create(
    userId: string | null,
    dto: CreateIotDeviceDto,
  ): Promise<IotDevice> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingCode = await queryRunner.manager.findOne(IotDevice, {
        where: { deviceCode: dto.deviceCode },
      });

      if (existingCode) {
        throw new ConflictException({
          code: 'DEVICE_CODE_EXISTS',
          message: 'Device code already exists in the system.',
        });
      }

      if (dto.macAddress) {
        const existingMac = await queryRunner.manager.findOne(IotDevice, {
          where: { macAddress: dto.macAddress },
        });

        if (existingMac) {
          throw new ConflictException({
            code: 'MAC_ADDRESS_EXISTS',
            message: 'MAC address already exists in the system.',
          });
        }
      }

      const newDevice = queryRunner.manager.create(IotDevice, {
        deviceName: dto.deviceName,
        deviceCode: dto.deviceCode,
        deviceType: dto.deviceType,
        ipAddress: dto.ipAddress || null,
        macAddress: dto.macAddress || null,
        metadataJson: dto.metadataJson || null,
        createdBy: userId,
        status: 'offline',
        healthStatus: 'unknown',
        lastSeenAt: null,
      });

      const savedDevice = await queryRunner.manager.save(IotDevice, newDevice);

      let createdByName: string | null = null;
      if (userId) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [userId],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          createdByName = userRow[0].full_name;
        }
      }

      await this.iotAuditRepository.logDeviceCreation(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        metadataJson: savedDevice.metadataJson,
      });

      await queryRunner.commitTransaction();

      // Attach dynamic property so the presenter can use it
      Object.assign(savedDevice, { createdByName });

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async assignRoom(
    userId: string | null,
    deviceId: string,
    dto: AssignRoomDto,
  ): Promise<IotDevice> {
    // Validate device
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.status === 'deleted' ||
      device.healthStatus === 'inactive' ||
      device.healthStatus === 'disabled'
    ) {
      throw new ConflictException({
        code: 'DEVICE_NOT_ACTIVE',
        message: 'Cannot assign room to an inactive or deleted device.',
      });
    }

    const allowedTypes = [
      IotDeviceType.DOOR_FACE_TERMINAL,
      IotDeviceType.IP_ROOM_CAMERA,
      IotDeviceType.ROOM_CAMERA,
    ];

    if (!allowedTypes.includes(device.deviceType)) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM',
        message: 'This device type cannot be assigned to a room.',
      });
    }

    // Idempotent case
    if (device.roomId === dto.roomId) {
      return device;
    }

    if (device.roomId && device.roomId !== dto.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ALREADY_ASSIGNED_TO_ROOM',
        message: 'Device is already assigned to a different room.',
      });
    }

    // Validate room
    const room: Array<{ id: string; is_active: boolean }> =
      await this.dataSource.manager.query(
        'SELECT id, is_active FROM rooms WHERE id = $1',
        [dto.roomId],
      );

    if (!room || room.length === 0) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
    }

    if (room[0].is_active === false) {
      throw new ConflictException({
        code: 'ROOM_NOT_ACTIVE',
        message: 'Room is not active.',
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const oldRoomId = device.roomId;

      device.roomId = dto.roomId;
      const savedDevice = await queryRunner.manager.save(IotDevice, device);

      await this.iotAuditRepository.logAssignRoom(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        oldRoomId: oldRoomId || null,
        newRoomId: savedDevice.roomId as string,
      });

      await queryRunner.commitTransaction();

      // Fetch createdByName based on the creator of the device
      if (savedDevice.createdBy) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [savedDevice.createdBy],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          Object.assign(savedDevice, { createdByName: userRow[0].full_name });
        }
      }

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async configureFaceServer(
    userId: string | null,
    deviceId: string,
    dto: ConfigureFaceServerDto,
  ): Promise<{ device: IotDevice; oneTimeCallbackToken: string }> {
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (device.deviceType !== IotDeviceType.DOOR_FACE_TERMINAL) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message:
          'Only door face terminal devices can be configured as a face server.',
      });
    }

    if (!device.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ROOM_ASSIGNMENT_REQUIRED',
        message:
          'Device must be assigned to a room before configuring face server.',
      });
    }

    // Process DTO and defaults
    const callback_enabled =
      dto.callback_enabled !== undefined ? dto.callback_enabled : true;

    // Generate tokens
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    const tokenLast4 = plainToken.slice(-4);
    const configuredAt = new Date().toISOString();

    const newFaceConfig = {
      callback_enabled,
      callback_protocol: dto.callback_protocol,
      callback_base_url: dto.callback_base_url,
      heartbeat_path: dto.heartbeat_path,
      verify_path: dto.verify_path,
      stranger_path: dto.stranger_path,
      allowed_source_ip: dto.allowed_source_ip,
      callback_token_hash: tokenHash,
      callback_token_last4: tokenLast4,
      configured_at: configuredAt,
    };

    const currentMetadata = device.metadataJson || {};
    const updatedMetadata = {
      ...currentMetadata,
      face_server_config: newFaceConfig,
    };

    device.metadataJson = updatedMetadata;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(IotDevice, device);

      await this.iotAuditRepository.logConfigureFaceServer(
        queryRunner.manager,
        {
          userId,
          deviceId: savedDevice.id,
          configMetadata: newFaceConfig,
        },
      );

      await queryRunner.commitTransaction();

      // Fetch createdByName based on the creator of the device
      if (savedDevice.createdBy) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [savedDevice.createdBy],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          Object.assign(savedDevice, { createdByName: userRow[0].full_name });
        }
      }

      return {
        device: savedDevice,
        oneTimeCallbackToken: plainToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
  async configureRtsp(
    userId: string | null,
    deviceId: string,
    dto: ConfigureRtspDto,
  ): Promise<IotDevice> {
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.deviceType !== IotDeviceType.IP_ROOM_CAMERA &&
      device.deviceType !== IotDeviceType.ROOM_CAMERA
    ) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_RTSP_CAMERA',
        message: 'Only IP room cameras can be configured with RTSP.',
      });
    }

    if (!device.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ROOM_ASSIGNMENT_REQUIRED',
        message: 'Device must be assigned to a room before configuring RTSP.',
      });
    }

    const currentMetadata = device.metadataJson || {};
    const currentRtspConfig = currentMetadata.rtsp_config || {};

    const rtsp_enabled =
      dto.rtsp_enabled !== undefined ? dto.rtsp_enabled : true;
    const rtsp_port = dto.rtsp_port !== undefined ? dto.rtsp_port : 554;
    const stream_profile = dto.stream_profile || 'main';

    let rtsp_password = currentRtspConfig.rtsp_password;
    if (dto.rtsp_password !== undefined) {
      rtsp_password = dto.rtsp_password;
    }

    const newRtspConfig = {
      rtsp_enabled,
      rtsp_protocol: dto.rtsp_protocol,
      rtsp_host: dto.rtsp_host,
      rtsp_port,
      rtsp_path: dto.rtsp_path,
      rtsp_username: dto.rtsp_username,
      rtsp_password,
      stream_profile,
      configured_at: new Date().toISOString(),
    };

    const updatedMetadata = {
      ...currentMetadata,
      rtsp_config: newRtspConfig,
    };

    device.metadataJson = updatedMetadata;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(IotDevice, device);

      await this.iotAuditRepository.logConfigureRtsp(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        configMetadata: newRtspConfig,
      });

      await queryRunner.commitTransaction();

      if (savedDevice.createdBy) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [savedDevice.createdBy],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          Object.assign(savedDevice, { createdByName: userRow[0].full_name });
        }
      }

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
  async checkAvailability(
    userId: string | null,
    deviceId: string,
  ): Promise<IotDevice> {
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.deviceType !== IotDeviceType.DOOR_FACE_TERMINAL &&
      device.deviceType !== IotDeviceType.IP_ROOM_CAMERA
    ) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_CAMERA',
        message: 'This device type is not supported for availability check.',
      });
    }

    let is_available = false;
    let check_type = '';
    let runtime_verified = false;
    let reason_code: string | null = null;
    let message = 'Camera availability checked successfully';

    if (device.deviceType === IotDeviceType.DOOR_FACE_TERMINAL) {
      check_type = 'heartbeat_status';
      if (device.lastSeenAt) {
        const now = new Date();
        const diffInMinutes =
          (now.getTime() - device.lastSeenAt.getTime()) / 60000;

        if (diffInMinutes <= 5) {
          is_available = true;
          runtime_verified = true;
          reason_code = null;
          device.status = 'online';
          device.healthStatus = 'healthy';
        } else {
          is_available = false;
          runtime_verified = true;
          reason_code = 'HEARTBEAT_STALE';
          device.status = 'offline';
          device.healthStatus = 'unhealthy';
        }
      } else {
        is_available = false;
        runtime_verified = false;
        reason_code = 'HEARTBEAT_NOT_SEEN';
        device.status = 'offline';
        device.healthStatus = 'unknown';
      }
    } else if (device.deviceType === IotDeviceType.IP_ROOM_CAMERA) {
      check_type = 'rtsp_config_readiness';
      runtime_verified = false;

      const rtspConfig = device.metadataJson?.rtsp_config;

      if (!device.roomId) {
        is_available = false;
        reason_code = 'DEVICE_ROOM_ASSIGNMENT_REQUIRED';
        device.healthStatus = 'not_configured';
      } else if (!rtspConfig) {
        is_available = false;
        reason_code = 'RTSP_CONFIG_MISSING';
        device.healthStatus = 'not_configured';
      } else if (rtspConfig.rtsp_enabled === false) {
        is_available = false;
        reason_code = 'RTSP_DISABLED';
        device.healthStatus = 'not_configured';
      } else if (
        rtspConfig.rtsp_host &&
        rtspConfig.rtsp_port &&
        rtspConfig.rtsp_path
      ) {
        is_available = true;
        reason_code = null;
        message =
          'RTSP configuration is ready. Runtime stream probing is not performed in this version.';
        device.healthStatus = 'unknown'; // Use unknown as fallback since config_ready is not standard
      } else {
        is_available = false;
        reason_code = 'RTSP_CONFIG_MISSING';
        device.healthStatus = 'not_configured';
      }
    }

    const currentMetadata = device.metadataJson || {};

    device.metadataJson = {
      ...currentMetadata,
      last_availability_check: {
        is_available,
        check_type,
        runtime_verified,
        reason_code,
        message,
        checked_at: new Date().toISOString(),
        checked_by: userId,
      },
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(IotDevice, device);

      // No audit log for this UC

      await queryRunner.commitTransaction();

      if (savedDevice.createdBy) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [savedDevice.createdBy],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          Object.assign(savedDevice, { createdByName: userRow[0].full_name });
        }
      }

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
