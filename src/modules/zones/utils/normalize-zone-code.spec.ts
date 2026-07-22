import { normalizeZoneCode } from './normalize-zone-code.js';

describe('normalizeZoneCode (ZNC-001 / UC-90)', () => {
  it('trim + toUpperCase', () => {
    expect(normalizeZoneCode(' gate-01 ')).toBe('GATE-01');
    expect(normalizeZoneCode('b1_lobby')).toBe('B1_LOBBY');
    expect(normalizeZoneCode('\tRoom 101\n')).toBe('ROOM 101');
  });

  it('GIỮ NGUYÊN ký tự phân tách — KHÔNG strip như normalizePlate (OQ-5)', () => {
    expect(normalizeZoneCode('GATE-01')).not.toBe('GATE01');
    expect(normalizeZoneCode('gate-01')).toBe('GATE-01');
    expect(normalizeZoneCode('b1_lobby')).toContain('_');
    // Khoảng trắng GIỮA chuỗi không bị bỏ (chỉ trim 2 đầu).
    expect(normalizeZoneCode(' khu a ')).toBe('KHU A');
  });

  it('chuỗi rỗng / toàn khoảng trắng → chuỗi rỗng', () => {
    expect(normalizeZoneCode('')).toBe('');
    expect(normalizeZoneCode('   ')).toBe('');
    expect(normalizeZoneCode('\t\n ')).toBe('');
  });

  it('KHÔNG bỏ dấu tiếng Việt', () => {
    expect(normalizeZoneCode('cổng-a')).toBe('CỔNG-A');
    expect(normalizeZoneCode('sảnh')).not.toBe('SANH');
  });

  it('idempotent: chuẩn hóa lần 2 không đổi kết quả', () => {
    const once = normalizeZoneCode('  gate-01  ');
    expect(normalizeZoneCode(once)).toBe(once);
  });
});
