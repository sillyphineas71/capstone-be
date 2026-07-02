import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RemoveExternalParticipantParamsDto } from './remove-external-participant-params.dto.js';
import { RemoveExternalParticipantBodyDto } from './remove-external-participant-body.dto.js';

describe('RemoveExternalParticipantParamsDto Validation', () => {
  it('should accept valid UUIDs', async () => {
    const dto = plainToInstance(RemoveExternalParticipantParamsDto, {
      meetingId: '550e8400-e29b-41d4-a716-446655440000',
      externalParticipantId: '550e8400-e29b-41d4-a716-446655440001',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject invalid meetingId UUID', async () => {
    const dto = plainToInstance(RemoveExternalParticipantParamsDto, {
      meetingId: 'not-a-uuid',
      externalParticipantId: '550e8400-e29b-41d4-a716-446655440001',
    });
    const errors = await validate(dto);
    const idErrors = errors.filter((e) => e.property === 'meetingId');
    expect(idErrors.length).toBeGreaterThan(0);
  });

  it('should reject invalid externalParticipantId UUID', async () => {
    const dto = plainToInstance(RemoveExternalParticipantParamsDto, {
      meetingId: '550e8400-e29b-41d4-a716-446655440000',
      externalParticipantId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    const idErrors = errors.filter(
      (e) => e.property === 'externalParticipantId',
    );
    expect(idErrors.length).toBeGreaterThan(0);
  });
});

describe('RemoveExternalParticipantBodyDto Validation', () => {
  it('should accept empty body (all optional)', async () => {
    const dto = plainToInstance(RemoveExternalParticipantBodyDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept valid reason', async () => {
    const dto = plainToInstance(RemoveExternalParticipantBodyDto, {
      reason: 'Khach hang bao ban',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject reason > 1000 chars', async () => {
    const dto = plainToInstance(RemoveExternalParticipantBodyDto, {
      reason: 'x'.repeat(1001),
    });
    const errors = await validate(dto);
    const reasonErrors = errors.filter((e) => e.property === 'reason');
    expect(reasonErrors.length).toBeGreaterThan(0);
  });

  it('should accept scope=instance', async () => {
    const dto = plainToInstance(RemoveExternalParticipantBodyDto, {
      scope: 'instance',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject invalid scope value', async () => {
    const dto = plainToInstance(RemoveExternalParticipantBodyDto, {
      scope: 'invalid-value',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
