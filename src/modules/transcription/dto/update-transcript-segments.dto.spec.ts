import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTranscriptSegmentsDto } from './update-transcript-segments.dto.js';

async function validateDto(obj: unknown) {
  const dto = plainToInstance(UpdateTranscriptSegmentsDto, obj);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateTranscriptSegmentsDto (UC-127)', () => {
  it('hợp lệ: 1 segment có segmentId + text', async () => {
    const errors = await validateDto({
      segments: [{ segmentId: 'seg-0', text: 'sửa' }],
    });
    expect(errors).toHaveLength(0);
  });

  it('segments rỗng → lỗi (ArrayMinSize)', async () => {
    const errors = await validateDto({ segments: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('thiếu segmentId → lỗi validate nested', async () => {
    const errors = await validateDto({ segments: [{ text: 'x' }] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('speakerUserId không phải UUID → lỗi', async () => {
    const errors = await validateDto({
      segments: [{ segmentId: 'seg-0', speakerUserId: 'not-a-uuid' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('speakerUserId UUID hợp lệ → pass', async () => {
    const errors = await validateDto({
      segments: [
        {
          segmentId: 'seg-0',
          speakerUserId: '550e8400-e29b-41d4-a716-446655440000',
        },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  it('field lạ → bị từ chối (forbidNonWhitelisted)', async () => {
    const errors = await validateDto({
      segments: [{ segmentId: 'seg-0' }],
      hacker: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
