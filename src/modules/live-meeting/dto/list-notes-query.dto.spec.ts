import { validate } from 'class-validator';
import { ListNotesQueryDto } from './list-notes-query.dto.js';

describe('ListNotesQueryDto', () => {
  it('should pass with default values', async () => {
    const dto = new ListNotesQueryDto();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail with limit > 100', async () => {
    const dto = new ListNotesQueryDto();
    dto.limit = 101;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('limit');
  });

  it('should fail with page < 1', async () => {
    const dto = new ListNotesQueryDto();
    dto.page = 0;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('should fail with q > 200 chars', async () => {
    const dto = new ListNotesQueryDto();
    dto.q = 'x'.repeat(201);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('q');
  });

  it('should fail with invalid noteType', async () => {
    const dto = new ListNotesQueryDto();
    dto.noteType = 'invalid';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('noteType');
  });

  it('should pass with valid noteType', async () => {
    const dto = new ListNotesQueryDto();
    dto.noteType = 'in_meeting';
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
