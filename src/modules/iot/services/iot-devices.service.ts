import { Injectable, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IotDevice } from '../entities/iot-device.entity';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto';
import { IotAuditRepository } from '../repositories/iot-audit.repository';

@Injectable()
export class IotDevicesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly iotAuditRepository: IotAuditRepository,
  ) {}

  async create(userId: string | null, dto: CreateIotDeviceDto): Promise<IotDevice> {
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

      let createdByName = null;
      if (userId) {
        const userRow = await queryRunner.query('SELECT full_name FROM users WHERE id = $1', [userId]);
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
      (savedDevice as any).createdByName = createdByName;

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
