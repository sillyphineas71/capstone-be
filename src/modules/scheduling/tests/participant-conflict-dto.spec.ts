import { validate } from 'class-validator';
import { CheckParticipantConflictDto } from '../dto/check-participant-conflict.dto.js';

describe('CheckParticipantConflictDto', () => {
  const validDto = {
    startTime: '2026-06-16T14:00:00+07:00',
    endTime: '2026-06-16T16:00:00+07:00',
    participantUserIds: ['550e8400-e29b-41d4-a716-446655440000'],
  };

  it('should pass with valid data', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), validDto);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when startTime is missing', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      startTime: undefined,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('startTime');
  });

  it('should fail when startTime is not ISO-8601', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      startTime: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('startTime');
  });

  it('should fail when endTime is missing', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      endTime: undefined,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('endTime');
  });

  it('should fail when participantUserIds is empty', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      participantUserIds: [],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('participantUserIds');
  });

  it('should fail when participantUserIds contains non-UUID', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      participantUserIds: ['not-a-uuid'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('participantUserIds');
  });

  it('should fail when participantUserIds exceeds 50', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      participantUserIds: Array(51).fill(
        '550e8400-e29b-41d4-a716-446655440000',
      ),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('participantUserIds');
  });

  it('should pass with optional excludeMeetingId', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      excludeMeetingId: '550e8400-e29b-41d4-a716-446655440001',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when excludeMeetingId is not UUID', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      excludeMeetingId: 'invalid-uuid',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('excludeMeetingId');
  });

  it('should pass with externalParticipantEmails', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      externalParticipantEmails: ['guest@example.com'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when externalParticipantEmails has invalid email', async () => {
    const dto = Object.assign(new CheckParticipantConflictDto(), {
      ...validDto,
      externalParticipantEmails: ['not-an-email'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('externalParticipantEmails');
  });
});
