import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';

describe('MeetingsController', () => {
  let controller: MeetingsController;
  let service: { create: jest.Mock; getAvailableRooms: jest.Mock };
  let reviewService: { approve: jest.Mock; reject: jest.Mock };

  const mockMeetingResponse = new CreateMeetingResponseDto({
    id: 'meeting-uuid',
    meetingCode: 'MT-20260715-001',
    title: 'Họp dự án',
    status: 'pending_approval',
    approvalStatus: 'pending',
    startTime: new Date('2026-07-15T10:00:00Z'),
    endTime: new Date('2026-07-15T11:00:00Z'),
    roomId: 'room-uuid',
    roomName: 'Phòng A',
    organizerId: 'auth-user-uuid',
    hostId: 'auth-user-uuid',
    participantCount: 3,
    bookingStatus: 'pending',
    bookingCode: 'BK-20260715-001',
    createdAt: new Date(),
  });

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      getAvailableRooms: jest.fn(),
    };

    reviewService = {
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        {
          provide: MeetingsService,
          useValue: service,
        },
        {
          provide: MeetingRequestReviewService,
          useValue: reviewService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MeetingsController>(MeetingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createMeeting', () => {
    it('[T030] should call service.create and return 201 response', async () => {
      const dto: CreateMeetingDto = {
        title: 'Họp dự án',
        startTime: '2026-07-15T10:00:00.000Z',
        endTime: '2026-07-15T11:00:00.000Z',
        roomId: 'room-uuid',
        participantUserIds: ['user-p1', 'user-p2'],
      };

      service.create.mockResolvedValue(mockMeetingResponse);

      const request = {
        user: { userId: 'auth-user-uuid' },
      } as unknown as Request;

      const result = await controller.createMeeting(
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(service.create).toHaveBeenCalledWith(
        dto,
        { userId: 'auth-user-uuid' },
        { ipAddress: '127.0.0.1', userAgent: 'Mozilla/5.0' },
      );
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe('meeting-uuid');
    });
  });

  describe('getAvailableRooms', () => {
    it('[T017c] should return available rooms list', async () => {
      const mockRooms = [
        {
          id: 'room-1',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          roomType: 'meeting_room',
          siteName: null,
          areaName: null,
          locationDescription: null,
          hasCamera: false,
          hasMicrophone: false,
          hasDisplay: true,
          allowRecording: false,
        },
      ];

      service.getAvailableRooms.mockResolvedValue(mockRooms);

      const result = await controller.getAvailableRooms(
        '2026-07-15T10:00:00Z',
        '2026-07-15T11:00:00Z',
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(service.getAvailableRooms).toHaveBeenCalled();
    });
  });
});
