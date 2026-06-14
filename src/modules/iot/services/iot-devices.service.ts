import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  IoTDeviceEntity,
  IoTDeviceType,
  IoTDeviceStatus,
  IoTDeviceHealthStatus,
} from '../entities/iot-device.entity.js';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto.js';
import { AssignRoomDto } from '../dto/assign-room.dto.js';
import { IotAuditRepository } from '../repositories/iot-audit.repository.js';

@Injectable()
export class IotDevicesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly iotAuditRepository: IotAuditRepository,
  ) { }

  async create(
    userId: string | null,
    dto: CreateIotDeviceDto,
  ): Promise<IoTDeviceEntity> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingCode = await queryRunner.manager.findOne(IoTDeviceEntity, {
        where: { deviceCode: dto.deviceCode },
      });

      if (existingCode) {
        throw new ConflictException({
          code: 'DEVICE_CODE_EXISTS',
          message: 'Device code already exists in the system.',
        });
      }

      if (dto.macAddress) {
        const existingMac = await queryRunner.manager.findOne(IoTDeviceEntity, {
          where: { macAddress: dto.macAddress },
        });

        if (existingMac) {
          throw new ConflictException({
            code: 'MAC_ADDRESS_EXISTS',
            message: 'MAC address already exists in the system.',
          });
        }
      }

      const newDevice = queryRunner.manager.create(IoTDeviceEntity, {
        deviceName: dto.deviceName,
        deviceCode: dto.deviceCode,
        deviceType: dto.deviceType,
        ipAddress: dto.ipAddress || null,
        macAddress: dto.macAddress || null,
        metadataJson: dto.metadataJson || null,
        status: IoTDeviceStatus.OFFLINE,
        healthStatus: IoTDeviceHealthStatus.UNKNOWN,
        lastSeenAt: null,
      });

      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        newDevice,
      );

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
  ): Promise<IoTDeviceEntity> {
    // Validate device
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.status === IoTDeviceStatus.DISABLED ||
      device.status === IoTDeviceStatus.MAINTENANCE ||
      device.healthStatus === IoTDeviceHealthStatus.FAULTY
    ) {
      throw new ConflictException({
        code: 'DEVICE_NOT_ACTIVE',
        message: 'Cannot assign room to an inactive device.',
      });
    }

    const allowedTypes = [
      IoTDeviceType.FACE_SERVER,
      IoTDeviceType.IP_CAMERA,
      IoTDeviceType.ROOM_CAMERA,
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
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logAssignRoom(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        oldRoomId: oldRoomId || null,
        newRoomId: savedDevice.roomId as string,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
