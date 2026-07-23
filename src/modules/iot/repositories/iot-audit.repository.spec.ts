import { IotAuditRepository } from './iot-audit.repository.js';

describe('IotAuditRepository.logConfigureAi (UC-96)', () => {
  it('INSERT audit_logs với action_type=configure_ai + bound param (3 cờ + deviceId)', async () => {
    const repo = new IotAuditRepository();
    const query = jest.fn().mockResolvedValue(undefined);
    const em = { query } as never;

    const configMetadata = {
      face_recognition: true,
      plate_recognition: false,
      people_counting: true,
      configured_at: '2026-07-23T00:00:00.000Z',
    };
    await repo.logConfigureAi(em, {
      userId: 'u1',
      deviceId: 'dev1',
      configMetadata,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'configure_ai'");
    expect(sql).toContain("'iot_devices'");
    expect(sql).toContain('$3::jsonb');
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('dev1');
    expect(params[2]).toBe(JSON.stringify(configMetadata));
  });

  it('userId null vẫn ghi (system/không xác định)', async () => {
    const repo = new IotAuditRepository();
    const query = jest.fn().mockResolvedValue(undefined);
    await repo.logConfigureAi({ query } as never, {
      userId: null,
      deviceId: 'dev1',
      configMetadata: { face_recognition: true },
    });
    expect((query.mock.calls[0] as unknown[])[0]).toBeDefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
