import { Test, TestingModule } from '@nestjs/testing';
import { ShortDeviceCallbacksController } from '../controllers/short-device-callbacks.controller';
import { IotDevicesService } from '../services/iot-devices.service';

describe('ShortDeviceCallbacksController', () => {
  let controller: ShortDeviceCallbacksController;
  let service: IotDevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShortDeviceCallbacksController],
      providers: [
        {
          provide: IotDevicesService,
          useValue: {
            receiveHeartbeat: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ShortDeviceCallbacksController>(
      ShortDeviceCallbacksController,
    );
    service = module.get<IotDevicesService>(IotDevicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleHeartbeatGet', () => {
    it('should call receiveHeartbeat and return success response', async () => {
      const mockResult = {
        device_code: 'TEST-CAM-001',
        status: 'online',
        health_status: 'healthy',
        last_seen_at: '2026-06-02T01:10:00.000Z',
        received_at: '2026-06-02T01:10:00.000Z',
      };
      (service.receiveHeartbeat as jest.Mock).mockResolvedValue(mockResult);

      const req = {
        headers: { 'x-device-code': 'TEST-CAM-001' },
        query: { t: 'short-token' },
        body: null,
        ip: '192.168.1.1',
      };

      const result = await controller.handleHeartbeatGet(req);

      expect(service.receiveHeartbeat).toHaveBeenCalledWith({
        headers: req.headers,
        body: null,
        query: req.query,
        params: {},
        clientIp: req.ip,
      });

      expect(result).toEqual({
        success: true,
        message: 'Heartbeat received successfully',
        data: mockResult,
      });
    });
  });

  describe('handleHeartbeatPost', () => {
    it('should call receiveHeartbeat and return success response', async () => {
      const mockResult = {
        device_code: 'TEST-CAM-002',
        status: 'online',
        health_status: 'healthy',
        last_seen_at: '2026-06-02T01:10:00.000Z',
        received_at: '2026-06-02T01:10:00.000Z',
      };
      (service.receiveHeartbeat as jest.Mock).mockResolvedValue(mockResult);

      const req = {
        headers: {},
        query: { d: 'TEST-CAM-002', t: 'short-token' },
        body: { status: 'ok' },
        socket: { remoteAddress: '192.168.1.2' },
      };

      const result = await controller.handleHeartbeatPost(req);

      expect(service.receiveHeartbeat).toHaveBeenCalledWith({
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: {},
        clientIp: req.socket.remoteAddress,
      });

      expect(result).toEqual({
        success: true,
        message: 'Heartbeat received successfully',
        data: mockResult,
      });
    });
  });

  describe('handleHeartbeatGetWithParams', () => {
    it('should call receiveHeartbeat and return success response', async () => {
      const mockResult = {
        device_code: 'TEST-CAM-003',
        status: 'online',
        health_status: 'healthy',
        last_seen_at: '2026-06-02T01:10:00.000Z',
        received_at: '2026-06-02T01:10:00.000Z',
      };
      (service.receiveHeartbeat as jest.Mock).mockResolvedValue(mockResult);

      const req = {
        headers: {},
        query: {},
        params: { deviceCode: 'TEST-CAM-003', callbackToken: 'path-token' },
        body: null,
        ip: '192.168.1.3',
      };

      const result = await controller.handleHeartbeatGetWithParams(req);

      expect(service.receiveHeartbeat).toHaveBeenCalledWith({
        headers: req.headers,
        body: null,
        query: req.query,
        params: req.params,
        clientIp: req.ip,
      });

      expect(result).toEqual({
        success: true,
        message: 'Heartbeat received successfully',
        data: mockResult,
      });
    });
  });

  describe('handleHeartbeatPostWithParams', () => {
    it('should call receiveHeartbeat and return success response', async () => {
      const mockResult = {
        device_code: 'TEST-CAM-004',
        status: 'online',
        health_status: 'healthy',
        last_seen_at: '2026-06-02T01:10:00.000Z',
        received_at: '2026-06-02T01:10:00.000Z',
      };
      (service.receiveHeartbeat as jest.Mock).mockResolvedValue(mockResult);

      const req = {
        headers: {},
        query: {},
        params: { deviceCode: 'TEST-CAM-004', callbackToken: 'path-token' },
        body: { status: 'ok' },
        socket: { remoteAddress: '192.168.1.4' },
      };

      const result = await controller.handleHeartbeatPostWithParams(req);

      expect(service.receiveHeartbeat).toHaveBeenCalledWith({
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
        clientIp: req.socket.remoteAddress,
      });

      expect(result).toEqual({
        success: true,
        message: 'Heartbeat received successfully',
        data: mockResult,
      });
    });
  });
});
