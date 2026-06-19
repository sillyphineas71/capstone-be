import { validate } from 'class-validator';
import { CreateNoteDto } from './create-note.dto.js';

describe('CreateNoteDto', () => {
  it('should pass with valid in_meeting note', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = 'Valid content';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail with empty content', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = '';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('content');
  });

  it('should pass with whitespace-only content (service handles rejection)', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = '   ';

    const errors = await validate(dto);
    // @IsNotEmpty does NOT fail on whitespace in class-validator;
    // service layer handles empty-after-sanitize check (FR-009)
    expect(errors.length).toBe(0);
  });

  it('should fail with invalid noteType', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'invalid_type';
    dto.content = 'Content';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('noteType');
  });

  it('should allow system_note through DTO (rejected later by service)', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'system_note';
    dto.content = 'System generated';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail with content exceeding max length', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = 'x'.repeat(10001);

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('content');
  });

  it('should fail with invalid visibilityLevel', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = 'Content';
    dto.visibilityLevel = 'everyone';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('visibilityLevel');
  });

  it('should pass with valid visibilityLevel', async () => {
    const dto = new CreateNoteDto();
    dto.noteType = 'in_meeting';
    dto.content = 'Content';
    dto.visibilityLevel = 'participants';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when noteType is missing', async () => {
    const dto = new CreateNoteDto();
    dto.content = 'Content';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('noteType');
  });
});
