import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RoomSuggestionQueryDto } from '../dto/room-suggestion-query.dto.js';
import { RoomType } from '../../../modules/rooms/entities/room.entity.js';

describe('RoomSuggestionQueryDto Validation', () => {
  describe('startTime', () => {
    it('[DTO-1] should accept valid ISO-8601 with timezone', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const startErrors = errors.filter((e) => e.property === 'startTime');
      expect(startErrors.length).toBe(0);
    });

    it('[DTO-2] should reject missing startTime', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const startErrors = errors.filter((e) => e.property === 'startTime');
      expect(startErrors.length).toBeGreaterThan(0);
    });

    it('[DTO-3] should reject invalid ISO format', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: 'not-a-date',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const startErrors = errors.filter((e) => e.property === 'startTime');
      expect(startErrors.length).toBeGreaterThan(0);
    });
  });

  describe('endTime', () => {
    it('[DTO-4] should accept valid ISO-8601 with timezone', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const endErrors = errors.filter((e) => e.property === 'endTime');
      expect(endErrors.length).toBe(0);
    });

    it('[DTO-5] should reject missing endTime', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const endErrors = errors.filter((e) => e.property === 'endTime');
      expect(endErrors.length).toBeGreaterThan(0);
    });
  });

  describe('attendeeCount', () => {
    it('[DTO-6] should accept positive integer', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      const errors = await validate(dto);
      const countErrors = errors.filter((e) => e.property === 'attendeeCount');
      expect(countErrors.length).toBe(0);
    });

    it('[DTO-7] should reject attendeeCount = 0', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 0,
        },
      );
      const errors = await validate(dto);
      const countErrors = errors.filter((e) => e.property === 'attendeeCount');
      expect(countErrors.length).toBeGreaterThan(0);
    });

    it('[DTO-8] should reject attendeeCount negative', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: -5,
        },
      );
      const errors = await validate(dto);
      const countErrors = errors.filter((e) => e.property === 'attendeeCount');
      expect(countErrors.length).toBeGreaterThan(0);
    });

    it('[DTO-9] should reject missing attendeeCount', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
        },
      );
      const errors = await validate(dto);
      const countErrors = errors.filter((e) => e.property === 'attendeeCount');
      expect(countErrors.length).toBeGreaterThan(0);
    });

    it('[DTO-10] should reject non-integer attendeeCount', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 3.5,
        },
      );
      const errors = await validate(dto);
      const countErrors = errors.filter((e) => e.property === 'attendeeCount');
      expect(countErrors.length).toBeGreaterThan(0);
    });
  });

  describe('optional fields', () => {
    it('[DTO-11] should accept valid roomType enum', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
          roomType: RoomType.MEETING_ROOM,
        },
      );
      const errors = await validate(dto);
      const typeErrors = errors.filter((e) => e.property === 'roomType');
      expect(typeErrors.length).toBe(0);
    });

    it('[DTO-12] should reject invalid roomType', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
          roomType: 'invalid_type',
        },
      );
      const errors = await validate(dto);
      const typeErrors = errors.filter((e) => e.property === 'roomType');
      expect(typeErrors.length).toBeGreaterThan(0);
    });

    it('[DTO-13] should accept optional fields as undefined', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
        },
      );
      expect(dto.siteName).toBeUndefined();
      expect(dto.areaName).toBeUndefined();
      expect(dto.allowRecording).toBeUndefined();
      expect(dto.hasCamera).toBeUndefined();
      expect(dto.hasMicrophone).toBeUndefined();
      expect(dto.hasDisplay).toBeUndefined();
    });

    it('[DTO-14] should transform boolean strings correctly', async () => {
      const dto = plainToInstance<RoomSuggestionQueryDto, any>(
        RoomSuggestionQueryDto,
        {
          startTime: '2026-06-10T09:00:00+07:00',
          endTime: '2026-06-10T11:00:00+07:00',
          attendeeCount: 5,
          allowRecording: true,
          hasCamera: true,
          hasMicrophone: false,
        },
      );
      expect(dto.allowRecording).toBe(true);
      expect(dto.hasCamera).toBe(true);
      expect(dto.hasMicrophone).toBe(false);
    });
  });
});
