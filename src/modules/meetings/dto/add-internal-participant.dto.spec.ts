import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddInternalParticipantDto } from './add-internal-participant.dto.js';

describe('AddInternalParticipantDto Validation', () => {
  describe('userId', () => {
    it('should accept valid UUID', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'userId');
      expect(idErrors.length).toBe(0);
    });

    it('should reject empty userId', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, { userId: '' });
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'userId');
      expect(idErrors.length).toBeGreaterThan(0);
    });

    it('should reject invalid UUID format', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'userId');
      expect(idErrors.length).toBeGreaterThan(0);
    });

    it('should reject missing userId', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {});
      const errors = await validate(dto);
      const idErrors = errors.filter((e) => e.property === 'userId');
      expect(idErrors.length).toBeGreaterThan(0);
    });
  });

  describe('overrideWarnings', () => {
    it('should accept boolean true', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        overrideWarnings: true,
      });
      const errors = await validate(dto);
      const capErrors = errors.filter((e) => e.property === 'overrideWarnings');
      expect(capErrors.length).toBe(0);
    });

    it('should accept boolean false', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        overrideWarnings: false,
      });
      const errors = await validate(dto);
      const capErrors = errors.filter((e) => e.property === 'overrideWarnings');
      expect(capErrors.length).toBe(0);
    });

    it('should reject non-boolean value', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        overrideWarnings: 'yes',
      });
      const errors = await validate(dto);
      const capErrors = errors.filter((e) => e.property === 'overrideWarnings');
      expect(capErrors.length).toBeGreaterThan(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('warningToken', () => {
    it('should accept valid string', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        warningToken:
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ3YXJuaW5nIiwiZXhwIjoxMjM0NTYsImlhdCI6MTIzNDU2fQ',
      });
      const errors = await validate(dto);
      const tokenErrors = errors.filter((e) => e.property === 'warningToken');
      expect(tokenErrors.length).toBe(0);
    });

    it('should reject non-string value', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        warningToken: 12345,
      });
      const errors = await validate(dto);
      const tokenErrors = errors.filter((e) => e.property === 'warningToken');
      expect(tokenErrors.length).toBeGreaterThan(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(AddInternalParticipantDto, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
