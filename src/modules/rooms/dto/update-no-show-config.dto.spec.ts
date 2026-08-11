import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateNoShowConfigDto } from './update-no-show-config.dto.js';

// [FIX 2026-08-09, Phần 2] presenceConfirmSeconds/presenceNoiseToleranceSeconds —
// đơn vị GIÂY, whitelist mới trong 5-field DTO. Mirror pattern
// create-recording-config.dto.spec.ts (ValidationPipe thật, không mock).
describe('UpdateNoShowConfigDto (validation, Phần 2 — 2 field mới đơn vị giây)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = {
    type: 'body' as const,
    metatype: UpdateNoShowConfigDto,
    data: '',
  };
  const run = (b: Record<string, unknown>): Promise<UpdateNoShowConfigDto> =>
    pipe.transform(b, meta) as Promise<UpdateNoShowConfigDto>;

  it('accepts valid presenceConfirmSeconds + presenceNoiseToleranceSeconds cùng lúc', async () => {
    const dto = await run({
      presenceConfirmSeconds: 30,
      presenceNoiseToleranceSeconds: 3,
    });
    expect(dto.presenceConfirmSeconds).toBe(30);
    expect(dto.presenceNoiseToleranceSeconds).toBe(3);
  });

  it('accepts presenceNoiseToleranceSeconds = 0 (min cho phép 0, khác 3 field cũ min=1)', async () => {
    const dto = await run({ presenceNoiseToleranceSeconds: 0 });
    expect(dto.presenceNoiseToleranceSeconds).toBe(0);
  });

  it('rejects presenceConfirmSeconds < 1 (min)', async () => {
    await expect(run({ presenceConfirmSeconds: 0 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects presenceConfirmSeconds > 3600 (max)', async () => {
    await expect(run({ presenceConfirmSeconds: 3601 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects presenceNoiseToleranceSeconds < 0 (âm)', async () => {
    await expect(run({ presenceNoiseToleranceSeconds: -1 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects presenceNoiseToleranceSeconds > 300 (max)', async () => {
    await expect(run({ presenceNoiseToleranceSeconds: 301 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects giá trị không phải số nguyên (float)', async () => {
    await expect(run({ presenceConfirmSeconds: 30.5 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('vẫn giữ whitelist forbidNonWhitelisted cho field lạ (không nới lỏng do thêm 2 field mới)', async () => {
    await expect(run({ presenceConfirmSecondsTypo: 30 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts body rỗng (mọi field optional) — không phá vỡ hành vi cũ', async () => {
    const dto = await run({});
    expect(dto).toBeDefined();
  });

  it('2 field mới đi cùng 3 field cũ + flag bool trong 1 request → đều nhận đúng', async () => {
    const dto = await run({
      thresholdMinutes: 20,
      warningGraceMinutes: 2,
      autoReleaseGraceMinutes: 6,
      presenceConfirmSeconds: 45,
      presenceNoiseToleranceSeconds: 5,
      autoReleaseEnabled: true,
    });
    expect(dto).toMatchObject({
      thresholdMinutes: 20,
      warningGraceMinutes: 2,
      autoReleaseGraceMinutes: 6,
      presenceConfirmSeconds: 45,
      presenceNoiseToleranceSeconds: 5,
      autoReleaseEnabled: true,
    });
  });
});
