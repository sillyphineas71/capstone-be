import { Test, TestingModule } from '@nestjs/testing';
import { IotDevicesService } from '../services/iot-devices.service';
import { DataSource } from 'typeorm';
import { IotAuditRepository } from '../repositories/iot-audit.repository';
import { IotDevice, IotDeviceType } from '../entities/iot-device.entity';
import { BadRequestException, NotFoundException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('IotDevicesService', () => {
  let service: IotDevicesService;
  let dataSource: any;

  beforeEach(async () => {
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn().mockImplementation((entity, obj) => Promise.resolve(obj)),
      },
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
      manager: {
        findOne: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IotDevicesService,
        { provide: DataSource, useValue: dataSource },
        { provide: IotAuditRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<IotDevicesService>(IotDevicesService);
  });

  describe('receiveVerifyEvent', () => {
    it('should throw BadRequestException if device_code is missing', async () => {
      await expect(service.receiveVerifyEvent({
        headers: {}, body: null, query: {}, clientIp: undefined
      })).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if device not found', async () => {
      dataSource.manager.findOne.mockResolvedValue(null);
      await expect(service.receiveVerifyEvent({
        headers: { 'x-device-code': 'TEST-CAM-001' }, body: null, query: {}, clientIp: undefined
      })).rejects.toThrow(NotFoundException);
    });

    it('should process successfully with valid input', async () => {
      const token = 'my-token';
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const mockDevice = {
        deviceCode: 'TEST-CAM-001',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: hash,
          }
        }
      };

      dataSource.manager.findOne.mockResolvedValue(mockDevice);

      const result = await service.receiveVerifyEvent({
        headers: { 'x-device-code': 'TEST-CAM-001', 'x-callback-token': token },
        body: { person_id: '123' },
        query: {},
        clientIp: '192.168.1.5',
      });

      expect(result.device_code).toBe('TEST-CAM-001');
      expect(result.event_type).toBe('face_verify');
      expect(mockDevice.status).toBe('online');
      expect(mockDevice.healthStatus).toBe('healthy');
      expect(mockDevice.metadataJson.recent_verify_event_samples.length).toBe(1);
    });

    it('should slice recent_verify_event_samples to 5 items', async () => {
      const token = 'my-token';
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const mockDevice = {
        deviceCode: 'TEST-CAM-001',
        deviceType: IotDeviceType.DOOR_FACE_TERMINAL,
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: hash,
          },
          recent_verify_event_samples: [1, 2, 3, 4, 5] // already 5
        }
      };

      dataSource.manager.findOne.mockResolvedValue(mockDevice);

      await service.receiveVerifyEvent({
        headers: { 'x-device-code': 'TEST-CAM-001', 'x-callback-token': token },
        body: null,
        query: {},
        clientIp: undefined,
      });

      expect(mockDevice.metadataJson.recent_verify_event_samples.length).toBe(5);
    });
  });
});
