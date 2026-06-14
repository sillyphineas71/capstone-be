import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateMeetingRoomDto } from './update-meeting-room.dto.js';

describe('UpdateMeetingRoomDto Validation', () => {
  describe('newRoomId', () => {
    it('should accept valid UUID', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'newRoomId');
      expect(idErrors.length).toBe(0);
    });

    it('should reject empty newRoomId', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, { newRoomId: '' });
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'newRoomId');
      expect(idErrors.length).toBeGreaterThan(0);
    });

    it('should reject invalid UUID format', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('confirmCapacityOverride', () => {
    it('should accept boolean true', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
        confirmCapacityOverride: true,
      });
      const errors = await validate(dto);
      const capErrors = errors.filter(
        (e) => e.property === 'confirmCapacityOverride',
      );
      expect(capErrors.length).toBe(0);
    });

    it('should reject non-boolean value', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
        confirmCapacityOverride: 'yes',
      });
      const errors = await validate(dto);
      const capErrors = errors.filter(
        (e) => e.property === 'confirmCapacityOverride',
      );
      expect(capErrors.length).toBeGreaterThan(0);
    });

    it('should default to false when not provided', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(dto.confirmCapacityOverride).toBe(false);
    });
  });

  describe('changeReason', () => {
    it('should accept valid reason string', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
        changeReason: 'Cần phòng lớn hơn',
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'changeReason');
      expect(reasonErrors.length).toBe(0);
    });

    it('should reject reason exceeding 500 characters', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
        changeReason: 'x'.repeat(501),
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'changeReason');
      expect(reasonErrors.length).toBeGreaterThan(0);
    });

    it('should accept missing changeReason', async () => {
      const dto = plainToInstance(UpdateMeetingRoomDto, {
        newRoomId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
