import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateTranscriptionJobDto,
  SpeakerMappingMode,
} from './create-transcription-job.dto.js';

describe('CreateTranscriptionJobDto', () => {
  const validUuid = '3d83fafc-34f4-4451-826a-fa699f52e30f';

  it('hợp lệ với chỉ recordingSessionId (mọi field khác optional)', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('recordingSessionId không phải UUID → lỗi validate', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: 'not-a-uuid',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'recordingSessionId')).toBe(true);
  });

  it('speakerMappingMode sai enum → lỗi validate', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
      speakerMappingMode: 'invalid_mode',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'speakerMappingMode')).toBe(true);
  });

  it('speakerMappingMode hợp lệ (channel_zone) → pass', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
      speakerMappingMode: SpeakerMappingMode.CHANNEL_ZONE,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('initialPrompt hợp lệ (custom vocabulary) → pass', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
      initialPrompt:
        'Vietcetera, podcast, marketing, design, creative, business',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('initialPrompt vượt quá 1000 ký tự → lỗi validate', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
      initialPrompt: 'a'.repeat(1001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'initialPrompt')).toBe(true);
  });

  it('forceRerun không phải boolean → lỗi validate', async () => {
    const dto = plainToInstance(CreateTranscriptionJobDto, {
      recordingSessionId: validUuid,
      forceRerun: 'yes',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'forceRerun')).toBe(true);
  });
});
