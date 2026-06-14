import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { UpdateIotDeviceDto } from './update-iot-device.dto.js';

describe('UpdateIotDeviceDto (validation + transform)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const meta = {
    type: 'body' as const,
    metatype: UpdateIotDeviceDto,
    data: '',
  };

  const run = (body: Record<string, unknown>): Promise<UpdateIotDeviceDto> =>
    pipe.transform(body, meta) as Promise<UpdateIotDeviceDto>;

  it('maps snake_case -> camelCase for valid payload', async () => {
    const dto = await run({
      device_name: 'Cam A',
      ip_address: '192.168.1.10',
    });
    expect(dto.deviceName).toBe('Cam A');
    expect(dto.ipAddress).toBe('192.168.1.10');
  });

  it('normalizes mac_address (dash/lowercase -> colon/uppercase)', async () => {
    const dto = await run({ mac_address: 'aa-bb-cc-dd-ee-ff' });
    expect(dto.macAddress).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('distinguishes absent field (undefined) from null', async () => {
    const dto = await run({ device_name: 'Cam A' });
    expect(dto.deviceName).toBe('Cam A');
    expect(dto.ipAddress).toBeUndefined();
    expect(dto.macAddress).toBeUndefined();
    expect(dto.networkIdentifier).toBeUndefined();
  });

  it('accepts null on connection fields (clear)', async () => {
    const dto = await run({
      ip_address: null,
      mac_address: null,
      network_identifier: null,
    });
    expect(dto.ipAddress).toBeNull();
    expect(dto.macAddress).toBeNull();
    expect(dto.networkIdentifier).toBeNull();
  });

  it('rejects device_name = null with 400', async () => {
    await expect(run({ device_name: null })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects empty device_name with 400', async () => {
    await expect(run({ device_name: '' })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid ip_address with 400', async () => {
    await expect(run({ ip_address: 'not-an-ip' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects fields outside allowlist with 400 (forbidNonWhitelisted)', async () => {
    await expect(run({ device_code: 'X' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(run({ status: 'offline' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(run({ metadata_json: { a: 1 } })).rejects.toThrow(
      BadRequestException,
    );
  });
});
