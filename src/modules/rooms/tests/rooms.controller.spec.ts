import { Test, TestingModule } from '@nestjs/testing';
import { RoomsController } from '../controllers/rooms.controller.js';
import { RoomsService } from '../services/rooms.service.js';

describe('RoomsController', () => {
  let controller: RoomsController;
  let roomsService: jest.Mocked<RoomsService>;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
  const mockRoomId = '660e8400-e29b-41d4-a716-446655440001';

  const validDto = {
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
  };

  const mockResponse = {
    id: mockRoomId,
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
    currentStatus: 'available',
    isActive: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    roomsService = {
      create: jest.fn().mockResolvedValue(mockResponse),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [{ provide: RoomsService, useValue: roomsService }],
    })
      .overrideGuard(require('../../auth/guards/jwt-auth.guard.js').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../auth/guards/permissions.guard.js').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RoomsController>(RoomsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should return 201 with room data on success', async () => {
      const result = await controller.create(
        validDto as any,
        { userId: mockUserId },
        '127.0.0.1',
        {} as any,
      );

      expect(roomsService.create).toHaveBeenCalledWith(validDto, mockUserId, '127.0.0.1');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Room created successfully');
      expect(result.data.roomCode).toBe('R301');
    });

    it('should throw error when userId is missing', async () => {
      await expect(
        controller.create(validDto as any, undefined, '127.0.0.1', {} as any),
      ).rejects.toThrow('userId is required');
    });

    it('should handle service errors', async () => {
      roomsService.create.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.create(validDto as any, { userId: mockUserId }, '127.0.0.1', {} as any),
      ).rejects.toThrow('Service error');
    });
  });
});
