import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RemoveParticipantBodyDto } from './remove-participant-body.dto.js';
import { RemoveScope } from '../types/remove-scope.type.js';

describe('RemoveParticipantBodyDto Validation', () => {
  describe('reason', () => {
    it('should accept valid reason within 1000 chars', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        reason: 'Valid reason for removal',
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'reason');
      expect(reasonErrors.length).toBe(0);
    });

    it('should accept empty/undefined reason', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {});
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'reason');
      expect(reasonErrors.length).toBe(0);
    });

    it('should reject reason exceeding 1000 characters', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        reason: 'x'.repeat(1001),
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'reason');
      expect(reasonErrors.length).toBeGreaterThan(0);
    });

    it('should accept reason exactly 1000 characters', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        reason: 'x'.repeat(1000),
      });
      const errors = await validate(dto);
      const reasonErrors = errors.filter((e) => e.property === 'reason');
      expect(reasonErrors.length).toBe(0);
    });
  });

  describe('scope', () => {
    it('should accept undefined scope (default to instance)', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {});
      const errors = await validate(dto);
      const scopeErrors = errors.filter((e) => e.property === 'scope');
      expect(scopeErrors.length).toBe(0);
    });

    it('should accept scope = instance', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        scope: RemoveScope.INSTANCE,
      });
      const errors = await validate(dto);
      const scopeErrors = errors.filter((e) => e.property === 'scope');
      expect(scopeErrors.length).toBe(0);
    });

    it('should accept scope = series', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        scope: RemoveScope.SERIES,
      });
      const errors = await validate(dto);
      const scopeErrors = errors.filter((e) => e.property === 'scope');
      expect(scopeErrors.length).toBe(0);
    });

    it('should reject invalid scope value', async () => {
      const dto = plainToInstance(RemoveParticipantBodyDto, {
        scope: 'invalid_value',
      });
      const errors = await validate(dto);
      const scopeErrors = errors.filter((e) => e.property === 'scope');
      expect(scopeErrors.length).toBeGreaterThan(0);
    });
  });
});
