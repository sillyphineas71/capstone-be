import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  Logger,
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
import { maskSensitiveMetadata } from '../../../common/utils/masking.util';

export interface HeartbeatInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
}

export interface VerifyEventInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
  files?: any[];
}

export interface StrangerEventInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
  files?: any[];
}

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

    // Generate short token (base64url) to fit hardware URL length limit
    const plainToken = crypto.randomBytes(16).toString('base64url');
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

  private readonly logger = new Logger(IotDevicesService.name);

  async receiveHeartbeat(input: HeartbeatInput) {
    const { headers, body, query, params, clientIp } = input;

    // 1. Extract device_code: header → body → query device_code → query d → path param deviceCode
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message:
          'device_code is required (header X-Device-Code, body, or query param).',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IotDeviceType.DOOR_FACE_TERMINAL) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support heartbeat callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token: header → body → query callback_token → query t → path param callbackToken
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message:
          'callback_token is required (header X-Callback-Token, body, or query param).',
      });
    }

    // 6. Verify callback token via SHA-256 hash
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'CALLBACK_TOKEN_NOT_CONFIGURED',
        message: 'Callback token has not been configured for this device.',
      });
    }

    const incomingHash = crypto
      .createHash('sha256')
      .update(callbackToken)
      .digest('hex');

    const storedHash = faceConfig.callback_token_hash;
    const incomingBuf = Buffer.from(incomingHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (
      incomingBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(incomingBuf, storedBuf)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Invalid callback token.',
      });
    }

    // 7. Check allowed_source_ip (best-effort)
    if (faceConfig.allowed_source_ip) {
      const normalizedClientIp = this.normalizeIp(clientIp);
      if (
        normalizedClientIp &&
        normalizedClientIp !== '127.0.0.1' &&
        normalizedClientIp !== '::1'
      ) {
        if (normalizedClientIp !== faceConfig.allowed_source_ip) {
          throw new ForbiddenException({
            code: 'SOURCE_IP_NOT_ALLOWED',
            message: `Source IP ${normalizedClientIp} is not allowed. Expected: ${faceConfig.allowed_source_ip}.`,
          });
        }
      } else {
        this.logger.warn(
          `Skipping IP check for device ${deviceCode}: client IP not deterministic (${clientIp}).`,
        );
      }
    }

    // 8. Process heartbeat
    const now = new Date();
    device.lastSeenAt = now;
    device.status = 'online';
    device.healthStatus = 'healthy';

    const normalizedClientIp = this.normalizeIp(clientIp);
    const rawSample = maskSensitiveMetadata(body || {}) || {};

    const currentMetadata = device.metadataJson || {};
    device.metadataJson = {
      ...currentMetadata,
      last_heartbeat: {
        received_at: now.toISOString(),
        source_ip: normalizedClientIp || null,
        payload_timestamp: body?.timestamp || null,
        device_status: body?.status || null,
        raw_payload_sample: rawSample,
      },
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(IotDevice, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return {
      device_code: device.deviceCode,
      status: device.status,
      health_status: device.healthStatus,
      last_seen_at: device.lastSeenAt,
      received_at: now,
    };
  }

  async receiveVerifyEvent(input: VerifyEventInput) {
    const { headers, body, query, params, clientIp, files } = input;

    // 1. Extract device_code
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message: 'device_code is required.',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IotDeviceType.DOOR_FACE_TERMINAL) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support verify callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message: 'callback_token is required.',
      });
    }

    // 6. Verify callback token via SHA-256 hash
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'CALLBACK_TOKEN_NOT_CONFIGURED',
        message: 'Callback token has not been configured for this device.',
      });
    }

    const incomingHash = crypto
      .createHash('sha256')
      .update(callbackToken)
      .digest('hex');

    const storedHash = faceConfig.callback_token_hash;
    const incomingBuf = Buffer.from(incomingHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (
      incomingBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(incomingBuf, storedBuf)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Invalid callback token.',
      });
    }

    // 7. Check allowed_source_ip (best-effort)
    const normalizedClientIp = this.normalizeIp(clientIp);
    if (faceConfig.allowed_source_ip) {
      if (
        normalizedClientIp &&
        normalizedClientIp !== '127.0.0.1' &&
        normalizedClientIp !== '::1'
      ) {
        if (normalizedClientIp !== faceConfig.allowed_source_ip) {
          throw new ForbiddenException({
            code: 'SOURCE_IP_NOT_ALLOWED',
            message: `Source IP ${normalizedClientIp} is not allowed. Expected: ${faceConfig.allowed_source_ip}.`,
          });
        }
      } else {
        this.logger.warn(
          `Skipping IP check for device ${deviceCode}: client IP not deterministic (${clientIp}).`,
        );
      }
    }

    // 8. Process payload tolerant ingestion
    const now = new Date();
    const extractedFields: any = {
      person_id: body?.person_id || null,
      person_name: body?.person_name || null,
      verify_time: body?.verify_time || null,
      verify_result: body?.verify_result || null,
      similarity: body?.similarity || null,
    };

    let payloadToMask: any = {};
    if (body) {
      // Create a shallow copy to mask
      payloadToMask = { ...body };
    } else {
      payloadToMask = {
        _unparseable: true,
        content_type: headers['content-type'] || 'unknown',
        content_length: headers['content-length'] || '0',
      };
    }

    // Add file metadata if files exist (don't log/save buffers)
    if (files && files.length > 0) {
      payloadToMask._files = files.map((f: any) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      }));
    }

    // Truncate long string fields
    let truncated = false;
    for (const key in payloadToMask) {
      if (
        typeof payloadToMask[key] === 'string' &&
        payloadToMask[key].length > 2000
      ) {
        payloadToMask[key] =
          payloadToMask[key].substring(0, 2000) + '... [TRUNCATED]';
        truncated = true;
      }
    }
    if (truncated) {
      payloadToMask.truncated = true;
    }

    const maskedSample = maskSensitiveMetadata(payloadToMask) || {};

    const newSample = {
      received_at: now.toISOString(),
      source_ip: normalizedClientIp || null,
      extracted_fields: extractedFields,
      raw_payload_sample: maskedSample,
    };

    // 9. Update DB
    device.lastSeenAt = now;
    device.status = 'online';
    device.healthStatus = 'healthy';

    const currentMetadata = device.metadataJson || {};
    const oldSamples = Array.isArray(
      currentMetadata.recent_verify_event_samples,
    )
      ? currentMetadata.recent_verify_event_samples
      : [];

    device.metadataJson = {
      ...currentMetadata,
      last_verify_event_sample: newSample,
      recent_verify_event_samples: [newSample, ...oldSamples].slice(0, 5),
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(IotDevice, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return {
      device_code: device.deviceCode,
      event_type: 'face_verify',
      received_at: now.toISOString(),
    };
  }

  async receiveStrangerEvent(input: StrangerEventInput) {
    const { headers, body, query, params, clientIp, files } = input;

    // 1. Extract device_code
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message: 'device_code is required.',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IotDevice, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IotDeviceType.DOOR_FACE_TERMINAL) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support stranger callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message: 'callback_token is required.',
      });
    }

    // 6. Verify callback token via SHA-256 hash
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'CALLBACK_TOKEN_NOT_CONFIGURED',
        message: 'Callback token has not been configured for this device.',
      });
    }

    const incomingHash = crypto
      .createHash('sha256')
      .update(callbackToken)
      .digest('hex');

    const storedHash = faceConfig.callback_token_hash;
    const incomingBuf = Buffer.from(incomingHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (
      incomingBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(incomingBuf, storedBuf)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Invalid callback token.',
      });
    }

    // 7. Check allowed_source_ip (best-effort)
    const normalizedClientIp = this.normalizeIp(clientIp);
    if (faceConfig.allowed_source_ip) {
      if (
        normalizedClientIp &&
        normalizedClientIp !== '127.0.0.1' &&
        normalizedClientIp !== '::1'
      ) {
        if (normalizedClientIp !== faceConfig.allowed_source_ip) {
          throw new ForbiddenException({
            code: 'SOURCE_IP_NOT_ALLOWED',
            message: `Source IP ${normalizedClientIp} is not allowed. Expected: ${faceConfig.allowed_source_ip}.`,
          });
        }
      } else {
        this.logger.warn(
          `Skipping IP check for device ${deviceCode}: client IP not deterministic (${clientIp}).`,
        );
      }
    }

    // 8. Process payload tolerant ingestion
    const now = new Date();
    const extractedFields: any = {
      stranger_id: body?.stranger_id || null,
      event_time: body?.event_time || null,
      capture_time: body?.capture_time || null,
      similarity: body?.similarity || null,
      event_result: 'stranger',
    };

    let payloadToMask: any = {};
    if (body && Object.keys(body).length > 0) {
      // Create a shallow copy to mask
      payloadToMask = { ...body };
    } else {
      payloadToMask = {
        _unparseable: true,
        content_type: headers['content-type'] || 'unknown',
        content_length: headers['content-length'] || '0',
        method: headers['method'] || 'unknown',
      };
    }

    // Add file metadata if files exist (don't log/save buffers)
    if (files && files.length > 0) {
      payloadToMask._files = files.map((f: any) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      }));
    }

    // Truncate long string fields
    let truncated = false;
    for (const key in payloadToMask) {
      if (
        typeof payloadToMask[key] === 'string' &&
        payloadToMask[key].length > 2000
      ) {
        payloadToMask[key] =
          payloadToMask[key].substring(0, 2000) + '... [TRUNCATED]';
        truncated = true;
      }
    }
    if (truncated) {
      payloadToMask.truncated = true;
    }

    const maskedSample = maskSensitiveMetadata(payloadToMask) || {};

    const newSample = {
      received_at: now.toISOString(),
      source_ip: normalizedClientIp || null,
      extracted_fields: extractedFields,
      raw_payload_sample: maskedSample,
    };

    // 9. Update DB
    device.lastSeenAt = now;
    device.status = 'online';
    device.healthStatus = 'healthy';

    const currentMetadata = device.metadataJson || {};
    const oldSamples = Array.isArray(
      currentMetadata.recent_stranger_event_samples,
    )
      ? currentMetadata.recent_stranger_event_samples
      : [];

    device.metadataJson = {
      ...currentMetadata,
      last_stranger_event_sample: newSample,
      recent_stranger_event_samples: [newSample, ...oldSamples].slice(0, 5),
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(IotDevice, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return {
      device_code: device.deviceCode,
      event_type: 'face_stranger',
      received_at: now.toISOString(),
    };
  }

  private extractValue(
    headerVal: string | string[] | undefined,
    bodyVal: any,
    queryVal: string | string[] | undefined,
    shortAliasVal?: string | string[],
    pathParamVal?: string | string[],
  ): string | null {
    // Header first
    if (headerVal) {
      const val = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Body second
    if (bodyVal !== undefined && bodyVal !== null) {
      const trimmed = String(bodyVal).trim();
      if (trimmed) return trimmed;
    }
    // Query third
    if (queryVal) {
      const val = Array.isArray(queryVal) ? queryVal[0] : queryVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Short Alias fourth
    if (shortAliasVal) {
      const val = Array.isArray(shortAliasVal)
        ? shortAliasVal[0]
        : shortAliasVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Path Param fifth
    if (pathParamVal) {
      const val = Array.isArray(pathParamVal) ? pathParamVal[0] : pathParamVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    return null;
  }

  private normalizeIp(ip: string | undefined): string | null {
    if (!ip) return null;
    // Strip ::ffff: prefix for IPv4-mapped IPv6
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  }
}
