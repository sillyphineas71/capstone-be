import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CancelMeetingDto } from './cancel-meeting.dto.js';

describe('CancelMeetingDto Validation', () => {
  describe('cancellationReason', () => {
    it('[T007-1] should accept valid reason under 1000 chars', async () => {
      const dto = plainToInstance(CancelMeetingDto, {
        cancellationReason: 'Phòng không phù hợp',
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter(
        (e) => e.property === 'cancellationReason',
      );
      expect(reasonErrors.length).toBe(0);
    });

    it('[T007-2] should accept empty body (optional)', async () => {
      const dto = plainToInstance(CancelMeetingDto, {});
      const errors = await validate(dto);
      const reasonErrors = errors.filter(
        (e) => e.property === 'cancellationReason',
      );
      expect(reasonErrors.length).toBe(0);
    });

    it('[T007-3] should reject reason exceeding 1000 chars', async () => {
      const dto = plainToInstance(CancelMeetingDto, {
        cancellationReason: 'x'.repeat(1001),
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter(
        (e) => e.property === 'cancellationReason',
      );
      expect(reasonErrors.length).toBeGreaterThan(0);
    });

    it('[T007-4] should reject non-string value', async () => {
      const dto = plainToInstance(CancelMeetingDto, {
        cancellationReason: 123,
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter(
        (e) => e.property === 'cancellationReason',
      );
      expect(reasonErrors.length).toBeGreaterThan(0);
    });

    it('[T007-5] should trim whitespace', async () => {
      const dto = plainToInstance(CancelMeetingDto, {
        cancellationReason: '  lý do  ',
      });
      expect(dto.cancellationReason).toBe('lý do');
    });
  });
});
