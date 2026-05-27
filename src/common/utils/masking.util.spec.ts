import { maskSensitiveMetadata } from './masking.util';

describe('maskSensitiveMetadata', () => {
  it('should return null for null or undefined', () => {
    expect(maskSensitiveMetadata(null)).toBeNull();
    expect(maskSensitiveMetadata(undefined)).toBeNull();
  });

  it('should not mask non-sensitive fields', () => {
    const input = { name: 'camera', type: 'ip' };
    expect(maskSensitiveMetadata(input)).toEqual({
      name: 'camera',
      type: 'ip',
    });
  });

  it('should mask fields containing secret, token, password', () => {
    const input = {
      secret_key: '123',
      callbackToken: 'abc',
      rtsp_password: 'pwd',
      normal_field: 'value',
    };
    expect(maskSensitiveMetadata(input)).toEqual({
      secret_key: '***',
      callbackToken: '***',
      rtsp_password: '***',
      normal_field: 'value',
    });
  });

  it('should handle masking recursively', () => {
    const input = {
      camera: {
        callbackToken: '123',
        normalKey: 'value',
        nested: {
          myPassword123: 'secret',
        },
      },
      rtsp_password: '456',
    };
    expect(maskSensitiveMetadata(input)).toEqual({
      camera: {
        callbackToken: '***',
        normalKey: 'value',
        nested: {
          myPassword123: '***',
        },
      },
      rtsp_password: '***',
    });
  });

  it('should handle arrays recursively', () => {
    const input = {
      items: [{ secretVal: '1' }, { normal: '2' }],
    };
    expect(maskSensitiveMetadata(input)).toEqual({
      items: [{ secretVal: '***' }, { normal: '2' }],
    });
  });
});
