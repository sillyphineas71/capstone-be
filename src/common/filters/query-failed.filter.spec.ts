import { QueryFailedFilter } from './query-failed.filter.js';

/**
 * Bug 2: trước đây MỌI unique violation (23505) đều bị dán nhãn
 * DEPARTMENT_ALREADY_EXISTS + "Tên phòng ban này đã được sử dụng" — kể cả trùng mã họp.
 */
describe('QueryFailedFilter.mapUniqueViolation', () => {
  it('department_code → DEPARTMENT_ALREADY_EXISTS (mã phòng ban)', () => {
    const r = QueryFailedFilter.mapUniqueViolation(
      'ux_departments_department_code',
    );
    expect(r.code).toBe('DEPARTMENT_ALREADY_EXISTS');
    expect(r.field).toBe('departmentCode');
    expect(r.message).toContain('Mã phòng ban');
  });

  it('department_name → DEPARTMENT_ALREADY_EXISTS (tên phòng ban)', () => {
    const r = QueryFailedFilter.mapUniqueViolation(
      'ux_departments_department_name',
    );
    expect(r.code).toBe('DEPARTMENT_ALREADY_EXISTS');
    expect(r.field).toBe('departmentName');
    expect(r.message).toContain('Tên phòng ban');
  });

  it('ux_meetings_code → MEETING_CODE_CONFLICT, KHÔNG phải department', () => {
    const r = QueryFailedFilter.mapUniqueViolation('ux_meetings_code');
    expect(r.code).toBe('MEETING_CODE_CONFLICT');
    expect(r.field).toBe('meetingCode');
    expect(r.message).not.toContain('phòng ban');
  });

  it('ux_room_bookings_code → BOOKING_CODE_CONFLICT', () => {
    const r = QueryFailedFilter.mapUniqueViolation('ux_room_bookings_code');
    expect(r.code).toBe('BOOKING_CODE_CONFLICT');
    expect(r.field).toBe('bookingCode');
    expect(r.message).not.toContain('phòng ban');
  });

  it('constraint lạ → mã trung tính, KHÔNG đoán bừa sang department', () => {
    const r = QueryFailedFilter.mapUniqueViolation('ux_something_else');
    expect(r.code).toBe('RESOURCE_ALREADY_EXISTS');
    expect(r.message).not.toContain('phòng ban');
  });

  it('constraint rỗng (driver không trả) → vẫn trung tính, không crash', () => {
    const r = QueryFailedFilter.mapUniqueViolation('');
    expect(r.code).toBe('RESOURCE_ALREADY_EXISTS');
    expect(r.field).toBe('unknown');
  });
});
