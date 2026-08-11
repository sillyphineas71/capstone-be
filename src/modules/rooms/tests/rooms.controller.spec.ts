import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoomsController } from '../controllers/rooms.controller.js';
import { RoomsService } from '../services/rooms.service.js';
import { RoomStatusService } from '../services/room-status.service.js';
import { RoomSearchService } from '../services/room-search.service.js';

describe('RoomsController', () => {
  let controller: RoomsController;
  let roomsService: jest.Mocked<RoomsService>;
  let roomStatusService: jest.Mocked<RoomStatusService>;
  let roomSearchService: jest.Mocked<RoomSearchService>;

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
      update: jest.fn().mockResolvedValue(mockResponse),
      getDeletionImpact: jest.fn(),
      deleteRoom: jest.fn(),
      getRoomDetail: jest.fn(),
    } as any;

    roomStatusService = {
      getRealtimeStatus: jest.fn(),
      getRoomStatus: jest.fn(),
    } as any;

    roomSearchService = {
      search: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        { provide: RoomsService, useValue: roomsService },
        { provide: RoomStatusService, useValue: roomStatusService },
        { provide: RoomSearchService, useValue: roomSearchService },
      ],
    })
      .overrideGuard(
        require('../../auth/guards/jwt-auth.guard.js').JwtAuthGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        require('../../auth/guards/permissions.guard.js').PermissionsGuard,
      )
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
        validDto,
        { userId: mockUserId },
        '127.0.0.1',
        {} as any,
      );

      expect(roomsService.create).toHaveBeenCalledWith(
        validDto,
        mockUserId,
        '127.0.0.1',
      );
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
        controller.create(
          validDto as any,
          { userId: mockUserId },
          '127.0.0.1',
          {} as any,
        ),
      ).rejects.toThrow('Service error');
    });
  });

  describe('update', () => {
    const updateDto = {
      roomName: 'Phong Hoi dong',
      areaName: 'Tang 5',
      capacity: 20,
    };

    it('should return 200 with updated room data on success', async () => {
      const result = await controller.update(
        mockRoomId,
        updateDto,
        { userId: mockUserId },
        '127.0.0.1',
      );

      expect(roomsService.update).toHaveBeenCalledWith(
        mockRoomId,
        updateDto,
        mockUserId,
        '127.0.0.1',
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Cập nhật thông tin phòng họp thành công');
      expect(result.data.roomCode).toBe('R301');
    });

    it('should throw error when userId is missing', async () => {
      await expect(
        controller.update(mockRoomId, updateDto as any, undefined, '127.0.0.1'),
      ).rejects.toThrow('userId is required');
    });

    it('should propagate service errors (e.g. ROOM_NOT_FOUND, ROOM_NAME_ALREADY_EXISTS)', async () => {
      roomsService.update.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.update(
          mockRoomId,
          updateDto as any,
          { userId: mockUserId },
          '127.0.0.1',
        ),
      ).rejects.toThrow('Service error');
    });
  });

  describe('deletionImpact', () => {
    it('should return 200 with impact data', async () => {
      const impact = {
        roomId: mockRoomId,
        roomName: 'Phong hop 301',
        affectedMeetingCount: 3,
        blockedByInProgressMeeting: false,
      };
      roomsService.getDeletionImpact.mockResolvedValue(impact);

      const result = await controller.deletionImpact(mockRoomId);

      expect(roomsService.getDeletionImpact).toHaveBeenCalledWith(mockRoomId);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(impact);
    });
  });

  describe('deleteRoom', () => {
    const deleteResponse = {
      roomId: mockRoomId,
      deletedAt: new Date(),
      affectedMeetingCount: 2,
      notificationJobId: 'job-1',
    };

    it('should return 200 with delete result on success', async () => {
      roomsService.deleteRoom.mockResolvedValue(deleteResponse);

      const result = await controller.deleteRoom(
        mockRoomId,
        { userId: mockUserId },
        '127.0.0.1',
      );

      expect(roomsService.deleteRoom).toHaveBeenCalledWith(
        mockRoomId,
        mockUserId,
        '127.0.0.1',
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Xóa phòng họp thành công');
      expect(result.data).toEqual(deleteResponse);
    });

    it('should throw error when userId is missing', async () => {
      await expect(
        controller.deleteRoom(mockRoomId, undefined, '127.0.0.1'),
      ).rejects.toThrow('userId is required');
    });

    it('should propagate service errors (e.g. ROOM_IN_USE, ROOM_NOT_FOUND)', async () => {
      roomsService.deleteRoom.mockRejectedValue(new Error('Service error'));

      await expect(
        controller.deleteRoom(mockRoomId, { userId: mockUserId }, '127.0.0.1'),
      ).rejects.toThrow('Service error');
    });
  });

  describe('search', () => {
    it('should return rooms with default success message when results found', async () => {
      roomSearchService.search.mockResolvedValue({
        rooms: [{ roomId: 'r1' } as any],
        meta: {
          page: 1,
          limit: 50,
          total: 1,
          totalPages: 1,
          appliedFilters: {},
        },
      });

      const result = await controller.search({});

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Danh sách phòng họp được truy xuất thành công',
      );
      expect(result.data).toHaveLength(1);
    });

    it('should return E1 message when no rooms match (empty state)', async () => {
      roomSearchService.search.mockResolvedValue({
        rooms: [],
        meta: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
          appliedFilters: { capacityMin: 1000 },
        },
      });

      const result = await controller.search({ capacityMin: 1000 });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Không có phòng họp nào khớp với các tiêu chí hiện tại. Vui lòng điều chỉnh bộ lọc của bạn.',
      );
      expect(result.data).toEqual([]);
    });
  });

  describe('getDetail (ROOM-VIEW-DETAIL-001)', () => {
    const mockDetailResponse = {
      roomId: mockRoomId,
      roomCode: 'R301',
      roomName: 'Phong hop 301',
      siteName: 'Toa A',
      areaName: 'Tang 3',
      locationDescription: null,
      capacity: 12,
      roomType: 'meeting_room',
      administrativeStatus: 'available',
      hasCamera: false,
      hasMicrophone: false,
      hasDisplay: false,
      allowRecording: false,
      layoutJson: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: { userId: mockUserId, fullName: 'Nguyen Van A' },
      updatedBy: null,
      occupancyStatus: {
        currentBooking: null,
        occupancyCount: 0,
        lastPresenceAt: null,
        noShowStatus: null,
      },
      upcomingBookings: [],
    };

    it('should return envelope {success, message, data} on success', async () => {
      roomsService.getRoomDetail.mockResolvedValue(mockDetailResponse);

      const result = await controller.getDetail(mockRoomId);

      expect(roomsService.getRoomDetail).toHaveBeenCalledWith(mockRoomId);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Room detail retrieved');
      expect(result.data).toEqual(mockDetailResponse);
    });

    it('should propagate 404 NotFoundException from service (AC-RVD-001-002)', async () => {
      roomsService.getRoomDetail.mockRejectedValue(
        new NotFoundException({
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found.',
        }),
      );

      await expect(controller.getDetail(mockRoomId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should call getRoomDetail with the correct roomId param', async () => {
      roomsService.getRoomDetail.mockResolvedValue(mockDetailResponse);

      await controller.getDetail(mockRoomId);

      expect(roomsService.getRoomDetail).toHaveBeenCalledTimes(1);
      expect(roomsService.getRoomDetail).toHaveBeenCalledWith(mockRoomId);
    });
  });
});
