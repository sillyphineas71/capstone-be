import { Test, TestingModule } from '@nestjs/testing';
import { VerifyShortDeviceCallbacksController } from '../controllers/verify-short-device-callbacks.controller';
import { IotDevicesService } from '../services/iot-devices.service';

describe('VerifyShortDeviceCallbacksController', () => {
  let controller: VerifyShortDeviceCallbacksController;
  let service: IotDevicesService;

  beforeEach(async () => {
    const mockIotDevicesService = {
      receiveVerifyEvent: jest.fn().mockResolvedValue({
        device_code: 'TEST-CAM-001',
        event_type: 'face_verify',
        received_at: new Date().toISOString(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VerifyShortDeviceCallbacksController],
      providers: [
        {
          provide: IotDevicesService,
          useValue: mockIotDevicesService,
        },
      ],
    }).compile();

    controller = module.get<VerifyShortDeviceCallbacksController>(VerifyShortDeviceCallbacksController);
    service = module.get<IotDevicesService>(IotDevicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleVerifyGetWithParams', () => {
    it('should call receiveVerifyEvent and return success response', async () => {
      const mockReq = {
        headers: { 'x-custom': 'test' },
        query: { q: '1' },
        params: { deviceCode: 'TEST-CAM-001', callbackToken: 'token123' },
        ip: '192.168.1.1',
      };

      const result = await controller.handleVerifyGetWithParams(mockReq);

      expect(service.receiveVerifyEvent).toHaveBeenCalledWith({
        headers: mockReq.headers,
        body: null,
        query: mockReq.query,
        params: mockReq.params,
        clientIp: mockReq.ip,
        files: [],
      });

      expect(result).toEqual({
        success: true,
        message: 'Verify event received successfully',
        data: expect.any(Object),
      });
    });
  });

  describe('handleVerifyPostWithParams', () => {
    it('should call receiveVerifyEvent with body and files', async () => {
      const mockReq = {
        headers: { 'content-type': 'multipart/form-data' },
        body: { person_id: 'p123' },
        query: {},
        params: { deviceCode: 'TEST-CAM-001', callbackToken: 'token123' },
        ip: '192.168.1.1',
        files: [{ fieldname: 'image', size: 1024 }],
      };

      const result = await controller.handleVerifyPostWithParams(mockReq);

      expect(service.receiveVerifyEvent).toHaveBeenCalledWith({
        headers: mockReq.headers,
        body: mockReq.body,
        query: mockReq.query,
        params: mockReq.params,
        clientIp: mockReq.ip,
        files: mockReq.files,
      });

      expect(result).toEqual({
        success: true,
        message: 'Verify event received successfully',
        data: expect.any(Object),
      });
    });
  });
});
