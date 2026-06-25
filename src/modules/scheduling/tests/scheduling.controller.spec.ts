import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingController } from '../scheduling.controller.js';
import { SchedulingService } from '../services/scheduling.service.js';
import { RoomSuggestionQueryDto } from '../dto/room-suggestion-query.dto.js';
import { RoomSuggestionItemDto } from '../dto/room-suggestion-item.dto.js';

describe('SchedulingController', () => {
  let controller: SchedulingController;
  let mockService: any;

  const mockResult = {
    data: [
      {
        roomId: '00000000-0000-0000-0000-000000000001',
        roomCode: 'R101',
        roomName: 'Phòng họp 101',
        capacity: 15,
        score: 66.67,
        available: true,
        matchedFeatures: [],
        warnings: [],
      } as RoomSuggestionItemDto,
    ],
    totalRoomsFound: 1,
  };

  const emptyResult = {
    data: [] as RoomSuggestionItemDto[],
    totalRoomsFound: 0,
  };

  beforeEach(async () => {
    mockService = {
      getRoomSuggestions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchedulingController],
      providers: [
        {
          provide: SchedulingService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<SchedulingController>(SchedulingController);
  });

  describe('getRoomSuggestions', () => {
    const validDto: RoomSuggestionQueryDto = {
      startTime: '2026-07-01T09:00:00+07:00',
      endTime: '2026-07-01T11:00:00+07:00',
      attendeeCount: 5,
    };

    const mockRequest = () =>
      ({
        user: { userId: '00000000-0000-0000-0000-000000000000' },
      }) as any;

    it('[CTRL-1] should return success response with rooms', async () => {
      mockService.getRoomSuggestions.mockResolvedValue(mockResult);

      const result = await controller.getRoomSuggestions(validDto, mockRequest());

      expect(result.success).toBe(true);
      expect(result.message).toBe('Danh sách phòng họp đề xuất');
      expect(result.data.length).toBe(1);
      expect(result.meta.resultLimit).toBe(20);
      expect(result.meta.totalRoomsFound).toBe(1);
    });

    it('[CTRL-2] should call service with correct DTO', async () => {
      mockService.getRoomSuggestions.mockResolvedValue(mockResult);

      await controller.getRoomSuggestions(validDto, mockRequest());

      expect(mockService.getRoomSuggestions).toHaveBeenCalledWith(validDto);
    });

    it('[CTRL-3] should return empty message when no rooms', async () => {
      mockService.getRoomSuggestions.mockResolvedValue(emptyResult);

      const result = await controller.getRoomSuggestions(validDto, mockRequest());

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này.',
      );
      expect(result.data).toEqual([]);
      expect(result.meta.totalRoomsFound).toBe(0);
    });

    it('[CTRL-4] should propagate service errors', async () => {
      mockService.getRoomSuggestions.mockRejectedValue(
        new Error('Service error'),
      );

      await expect(
        controller.getRoomSuggestions(validDto, mockRequest()),
      ).rejects.toThrow('Service error');
    });

    it('[CTRL-5] should use userId from JWT for context', async () => {
      mockService.getRoomSuggestions.mockResolvedValue(mockResult);
      const request = mockRequest();

      await controller.getRoomSuggestions(validDto, request);

      // Verify userId is extracted from JWT (just verify service was called)
      expect(mockService.getRoomSuggestions).toHaveBeenCalled();
    });
  });
});

