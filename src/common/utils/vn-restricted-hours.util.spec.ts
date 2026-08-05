import { isOutsideAllowedHoursVn } from './vn-restricted-hours.util.js';

/** Giả lập "giờ VN" bằng cách build 1 Date UTC tương ứng đúng giờ VN mong muốn (UTC+7, không DST). */
const vnDate = (hh: number, mm: number): Date =>
  new Date(Date.UTC(2026, 0, 15, hh - 7, mm));

describe('isOutsideAllowedHoursVn', () => {
  it('không có allowFrom/allowTo → fail-closed, LUÔN ngoài giờ (mirror isViolation gốc)', () => {
    expect(isOutsideAllowedHoursVn(null, vnDate(10, 0))).toBe(true);
    expect(isOutsideAllowedHoursVn({}, vnDate(10, 0))).toBe(true);
    expect(isOutsideAllowedHoursVn({ allowFrom: '08:00' }, vnDate(10, 0))).toBe(
      true,
    );
  });

  it('trong khung giờ thường (08:00-18:00) → KHÔNG ngoài giờ', () => {
    const hours = { allowFrom: '08:00', allowTo: '18:00' };
    expect(isOutsideAllowedHoursVn(hours, vnDate(9, 0))).toBe(false);
    expect(isOutsideAllowedHoursVn(hours, vnDate(8, 0))).toBe(false);
    expect(isOutsideAllowedHoursVn(hours, vnDate(18, 0))).toBe(false);
  });

  it('ngoài khung giờ thường → ngoài giờ', () => {
    const hours = { allowFrom: '08:00', allowTo: '18:00' };
    expect(isOutsideAllowedHoursVn(hours, vnDate(19, 0))).toBe(true);
    expect(isOutsideAllowedHoursVn(hours, vnDate(6, 0))).toBe(true);
  });

  it('khung qua đêm (22:00-06:00): 23:00 trong khung, 12:00 ngoài khung', () => {
    const hours = { allowFrom: '22:00', allowTo: '06:00' };
    expect(isOutsideAllowedHoursVn(hours, vnDate(23, 0))).toBe(false);
    expect(isOutsideAllowedHoursVn(hours, vnDate(3, 0))).toBe(false);
    expect(isOutsideAllowedHoursVn(hours, vnDate(12, 0))).toBe(true);
  });

  it('tính theo giờ VN bất kể TZ runtime của process (dùng Intl, KHÔNG Date#getHours local)', () => {
    // 09:00 giờ VN = 02:00 UTC — nếu code dùng getHours() local (mà process chạy UTC) sẽ
    // đọc ra 2h (ngoài khung 08-18), trong khi thực ra 9h VN đang TRONG khung.
    const utcDate = new Date('2026-01-15T02:00:00.000Z');
    const hours = { allowFrom: '08:00', allowTo: '18:00' };
    expect(isOutsideAllowedHoursVn(hours, utcDate)).toBe(false);
  });
});
