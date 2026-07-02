import { validate } from 'class-validator';
import { ViewNotesQueryDto } from './view-notes-query.dto.js';

describe('ViewNotesQueryDto', () => {
  it('should pass with empty dto (all defaults)', async () => {
    const dto = new ViewNotesQueryDto();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should accept valid noteType values', async () => {
    for (const val of ['in_meeting', 'private', 'host_note', 'system_note']) {
      const dto = new ViewNotesQueryDto();
      dto.noteType = val;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should reject invalid noteType', async () => {
    const dto = new ViewNotesQueryDto();
    dto.noteType = 'invalid_type';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should accept valid visibility values', async () => {
    for (const val of [
      'private',
      'participants',
      'public_internal',
      'department',
    ]) {
      const dto = new ViewNotesQueryDto();
      dto.visibility = val;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should reject invalid visibility', async () => {
    const dto = new ViewNotesQueryDto();
    dto.visibility = 'public';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should accept valid sort values', async () => {
    for (const val of ['timeline_asc', 'timeline_desc']) {
      const dto = new ViewNotesQueryDto();
      dto.sort = val;
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    }
  });

  it('should reject invalid sort', async () => {
    const dto = new ViewNotesQueryDto();
    dto.sort = 'created_at_asc';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should accept valid ISO date strings for from/to', async () => {
    const dto = new ViewNotesQueryDto();
    dto.from = '2026-06-18T09:00:00Z';
    dto.to = '2026-06-18T11:00:00Z';
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject non-ISO date string for from', async () => {
    const dto = new ViewNotesQueryDto();
    dto.from = 'not-a-date';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should accept boolean includeSourceEvent as string "true"', async () => {
    const dto = new ViewNotesQueryDto();
    dto.includeSourceEvent = true;
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when limit > 100', async () => {
    const dto = new ViewNotesQueryDto();
    dto.limit = 101;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('should fail when page < 1', async () => {
    const dto = new ViewNotesQueryDto();
    dto.page = 0;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });
});
