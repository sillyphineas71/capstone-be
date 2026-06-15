import { encryptSecret, decryptSecret } from './secret-crypto.util.js';

describe('secret-crypto.util (IOT-015)', () => {
  const OLD = process.env.RTSP_CRED_KEY;
  beforeAll(() => {
    process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
  });
  afterAll(() => {
    process.env.RTSP_CRED_KEY = OLD;
  });

  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = 'P@ssw0rd-cam-301!';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('IV ngẫu nhiên: 2 lần encrypt ra blob khác nhau, cả 2 decrypt đúng', () => {
    const plain = 'same-secret';
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it('tamper: sửa 1 byte blob → ném (authTag fail)', () => {
    const blob = encryptSecret('secret');
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] ^= 0xff; // lật byte cuối (ciphertext)
    const tampered = buf.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('blob quá ngắn → ném', () => {
    const shortBlob = Buffer.from('short').toString('base64');
    expect(() => decryptSecret(shortBlob)).toThrow('Invalid encrypted blob');
  });

  it('thiếu RTSP_CRED_KEY → ném', () => {
    const saved = process.env.RTSP_CRED_KEY;
    delete process.env.RTSP_CRED_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow('RTSP_CRED_KEY');
    } finally {
      process.env.RTSP_CRED_KEY = saved;
    }
  });

  it('utf8/ký tự đặc biệt round-trip', () => {
    const plain = 'mật-khẩu-#$%^&*()_+ 你好';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });
});
