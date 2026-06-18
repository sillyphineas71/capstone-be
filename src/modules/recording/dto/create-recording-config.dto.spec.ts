import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateRecordingConfigDto } from './create-recording-config.dto.js';

describe('CreateRecordingConfigDto (validation)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = {
    type: 'body' as const,
    metatype: CreateRecordingConfigDto,
    data: '',
  };
  const run = (b: Record<string, unknown>): Promise<CreateRecordingConfigDto> =>
    pipe.transform(b, meta) as Promise<CreateRecordingConfigDto>;

  it('accepts valid body', async () => {
    const dto = await run({
      enableVideo: true,
      audioSourceMode: 'room_mix',
      retentionDays: 30,
    });
    expect(dto.enableVideo).toBe(true);
    expect(dto.audioSourceMode).toBe('room_mix');
    expect(dto.retentionDays).toBe(30);
  });

  it('accepts empty body (all optional)', async () => {
    const dto = await run({});
    expect(dto).toBeDefined();
  });

  it('rejects retentionDays > 365', async () => {
    await expect(run({ retentionDays: 400 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects retentionDays <= 0', async () => {
    await expect(run({ retentionDays: 0 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid audioSourceMode enum', async () => {
    await expect(run({ audioSourceMode: 'bogus' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid videoSourceDeviceId uuid', async () => {
    await expect(run({ videoSourceDeviceId: 'not-uuid' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects field outside allowlist (forbidNonWhitelisted)', async () => {
    await expect(run({ status: 'active' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(run({ meetingId: 'x' })).rejects.toThrow(BadRequestException);
  });

  it('rejects non-boolean enableAudio', async () => {
    await expect(run({ enableAudio: 'yes' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
