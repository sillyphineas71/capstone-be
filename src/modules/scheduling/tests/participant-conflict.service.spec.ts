import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getEntityManagerToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { ParticipantConflictService } from '../services/participant-conflict.service.js';
import { CheckParticipantConflictDto } from '../dto/check-participant-conflict.dto.js';

describe('ParticipantConflictService', () => {
  let service: ParticipantConflictService;
  let mockEntityManager: jest.Mocked<Partial<EntityManager>>;

  const mockQuery = jest.fn();

  beforeEach(async () => {
    mockQuery.mockReset();

    mockEntityManager = {
      query: mockQuery,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipantConflictService,
        {
          provide: getEntityManagerToken(),
          useValue: mockEntityManager,
        },
      ],
    }).compile();

    service = module.get<ParticipantConflictService>(
      ParticipantConflictService,
    );
  });

  const validDto: CheckParticipantConflictDto = {
    startTime: '2026-06-16T14:00:00+07:00',
    endTime: '2026-06-16T16:00:00+07:00',
    participantUserIds: ['550e8400-e29b-41d4-a716-446655440000'],
  };

  describe('AC-001: Participant busy detection', () => {
    it('should return busy when participant has overlapping meeting', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }]) // users exist
        .mockResolvedValueOnce([{ user_id: validDto.participantUserIds[0] }]) // conflict found
        .mockResolvedValueOnce([
          // busy slots
          {
            start_time: '2026-06-16T14:00:00+07:00',
            end_time: '2026-06-16T15:30:00+07:00',
          },
        ]);

      const result = await service.checkConflicts(validDto);

      expect(result.hasConflict).toBe(true);
      expect(result.participants[0].status).toBe('busy');
      expect(result.participants[0].busySlots).toHaveLength(1);
      expect(result.participants[0].displayWarning).toBe(true);
      expect(result.participants[0].warningMessage).toContain('Bận');
    });
  });

  describe('AC-002: Participant free detection', () => {
    it('should return free when participant has no overlapping meeting', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }]) // users exist
        .mockResolvedValueOnce([]); // no conflict

      const result = await service.checkConflicts(validDto);

      expect(result.hasConflict).toBe(false);
      expect(result.participants[0].status).toBe('free');
      expect(result.participants[0].busySlots).toHaveLength(0);
      expect(result.participants[0].displayWarning).toBe(false);
      expect(result.participants[0].warningMessage).toBeNull();
    });
  });

  describe('AC-004: External participant unknown', () => {
    it('should return unknown for external participant', async () => {
      const dtoWithExternal: CheckParticipantConflictDto = {
        ...validDto,
        externalParticipantEmails: ['guest@external.com'],
      };

      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }]) // users exist
        .mockResolvedValueOnce([]); // no conflict

      const result = await service.checkConflicts(dtoWithExternal);

      expect(result.externalParticipants).toHaveLength(1);
      expect(result.externalParticipants[0].status).toBe('unknown');
      expect(result.externalParticipants[0].warningMessage).toBe(
        'Không rõ lịch trình',
      );
    });
  });

  describe('AC-007: Privacy-safe response', () => {
    it('should NOT include title, description, room, or participant list of other meetings', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ user_id: validDto.participantUserIds[0] }])
        .mockResolvedValueOnce([
          {
            start_time: '2026-06-16T14:00:00+07:00',
            end_time: '2026-06-16T15:30:00+07:00',
          },
        ]);

      const result = await service.checkConflicts(validDto);
      const responseJson = JSON.stringify(result);

      expect(responseJson).not.toContain('title');
      expect(responseJson).not.toContain('description');
      expect(responseJson).not.toContain('roomName');
      expect(responseJson).not.toContain('agenda');
    });
  });

  describe('AC-008: Overlap cross boundary', () => {
    it('should detect meeting that crosses start boundary', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ user_id: validDto.participantUserIds[0] }])
        .mockResolvedValueOnce([
          {
            start_time: '2026-06-16T13:00:00+07:00',
            end_time: '2026-06-16T15:00:00+07:00',
          },
        ]);

      const result = await service.checkConflicts(validDto);

      expect(result.hasConflict).toBe(true);
      expect(result.participants[0].status).toBe('busy');
    });
  });

  describe('AC-009: Exclude meeting', () => {
    it('should exclude specified meeting from conflict check', async () => {
      const dtoWithExclude: CheckParticipantConflictDto = {
        ...validDto,
        excludeMeetingId: '550e8400-e29b-41d4-a716-446655440099',
      };

      // users exist, meeting exists, no participant conflict (because excluded)
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([
          {
            id: '550e8400-e29b-41d4-a716-446655440099',
            organizer_id: '550e8400-e29b-41d4-a716-446655440000',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.checkConflicts(
        dtoWithExclude,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result.hasConflict).toBe(false);
      expect(result.participants[0].status).toBe('free');
    });
  });

  describe('AC-011: User not found', () => {
    it('should throw BadRequestException when participant does not exist', async () => {
      mockQuery.mockResolvedValueOnce([{ cnt: 0 }]); // user not found

      await expect(service.checkConflicts(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('AC-013: Merge busy slots', () => {
    it('should merge overlapping busy slots into one', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{ user_id: validDto.participantUserIds[0] }])
        .mockResolvedValueOnce([
          {
            start_time: '2026-06-16T14:00:00+07:00',
            end_time: '2026-06-16T15:00:00+07:00',
          },
          {
            start_time: '2026-06-16T14:30:00+07:00',
            end_time: '2026-06-16T15:30:00+07:00',
          },
          {
            start_time: '2026-06-16T15:30:00+07:00',
            end_time: '2026-06-16T16:00:00+07:00',
          },
        ]);

      const result = await service.checkConflicts(validDto);

      expect(result.participants[0].busySlots).toHaveLength(1);
      expect(result.participants[0].busySlots[0].busyFrom).toContain('14:00');
      expect(result.participants[0].busySlots[0].busyTo).toContain('16:00');
    });
  });

  describe('AC-014: IDOR excludeMeetingId', () => {
    it('should throw ForbiddenException when user has no access to excludeMeetingId', async () => {
      const dtoWithExclude: CheckParticipantConflictDto = {
        ...validDto,
        excludeMeetingId: '550e8400-e29b-41d4-a716-446655440099',
      };

      // Meeting exists but user is not organizer and not participant
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([
          {
            id: '550e8400-e29b-41d4-a716-446655440099',
            organizer_id: 'other-user-id',
          },
        ])
        .mockResolvedValueOnce([]); // not a participant

      await expect(
        service.checkConflicts(
          dtoWithExclude,
          '550e8400-e29b-41d4-a716-446655440000',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Validation: Invalid time range', () => {
    it('should throw BadRequestException when startTime > endTime', async () => {
      const invalidDto: CheckParticipantConflictDto = {
        ...validDto,
        startTime: '2026-06-16T16:00:00+07:00',
        endTime: '2026-06-16T14:00:00+07:00',
      };

      await expect(service.checkConflicts(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
