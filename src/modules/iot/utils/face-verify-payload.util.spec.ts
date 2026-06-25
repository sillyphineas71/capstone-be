import {
  parseVerifyPayload,
  stripSanpPic,
} from './face-verify-payload.util.js';

// Payload thật cam FaceGate VerifyPush (rút gọn).
const realPayload = (over: Record<string, unknown> = {}) => ({
  operator: 'VerifyPush',
  info: {
    PersonID: 70,
    Name: 'u1:m1',
    CreateTime: '2026-06-17 09:00:00',
    Similarity1: 98,
    VerifyStatus: 1,
    ...((over.info as object) ?? {}),
  },
  dwFileIndex: 1,
  dwFilePos: 4259840,
  SanpPic: 'data:image/jpeg;base64,/9j/4AAQSkZJR= ...',
  ...over,
});

describe('parseVerifyPayload (FAT-001 ingestion)', () => {
  it('VerifyPush hợp lệ: lấy danh tính từ info.*, PersonID số → chuỗi', () => {
    const r = parseVerifyPayload(realPayload());
    expect(r.isValid).toBe(true);
    expect(r.personId).toBe('70');
    expect(r.personName).toBe('u1:m1');
  });

  it('DCO-001 PURE: trích directionRaw/opendoorWay thô, KHÔNG suy in/out, KHÔNG đọc env', () => {
    const r = parseVerifyPayload(
      realPayload({ info: { Direction: 2, OpendoorWay: 1 } }),
    );
    expect(r.directionRaw).toBe('2'); // số → chuỗi thô
    expect(r.opendoorWay).toBe('1');
    // ParsedVerify KHÔNG có field 'direction' (map IN/OUT làm ở service).
    expect('direction' in r).toBe(false);
  });

  it('DCO-001: thiếu Direction/OpendoorWay → null', () => {
    const r = parseVerifyPayload(realPayload());
    expect(r.directionRaw).toBeNull();
    expect(r.opendoorWay).toBeNull();
  });

  it('operator ≠ VerifyPush → KHÔNG hợp lệ', () => {
    const r = parseVerifyPayload(realPayload({ operator: 'Heartbeat' }));
    expect(r.isValid).toBe(false);
    // vẫn trích được danh tính nhưng gate chặn ghi
    expect(r.personId).toBe('70');
  });

  it('VerifyStatus ≠ 1 → KHÔNG hợp lệ', () => {
    const r = parseVerifyPayload(realPayload({ info: { VerifyStatus: 0 } }));
    expect(r.isValid).toBe(false);
  });

  it('PersonID null/rỗng → personId null', () => {
    expect(
      parseVerifyPayload(realPayload({ info: { PersonID: null } })).personId,
    ).toBeNull();
    expect(
      parseVerifyPayload(realPayload({ info: { PersonID: '' } })).personId,
    ).toBeNull();
  });

  it('PersonID dạng chuỗi → giữ chuỗi', () => {
    expect(
      parseVerifyPayload(realPayload({ info: { PersonID: '512' } })).personId,
    ).toBe('512');
  });

  it('body null / thiếu info → no record, nulls', () => {
    const r1 = parseVerifyPayload(null);
    expect(r1.isValid).toBe(false);
    expect(r1.personId).toBeNull();
    expect(r1.personName).toBeNull();
    const r2 = parseVerifyPayload({ operator: 'VerifyPush' });
    expect(r2.isValid).toBe(false);
    expect(r2.personName).toBeNull();
  });
});

describe('stripSanpPic (FAT-001 ingestion)', () => {
  it('thay SanpPic = [stripped], KHÔNG mutate input, giữ field khác', () => {
    const original = realPayload();
    const out = stripSanpPic(original);
    expect(out.SanpPic).toBe('[stripped]');
    expect(out.operator).toBe('VerifyPush');
    expect((out.info as { Name: string }).Name).toBe('u1:m1');
    // input KHÔNG bị mutate (vẫn còn base64 gốc)
    expect(original.SanpPic.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('payload không có SanpPic → trả copy nguyên trạng', () => {
    const out = stripSanpPic({ operator: 'Heartbeat', a: 1 });
    expect(out).toEqual({ operator: 'Heartbeat', a: 1 });
    expect('SanpPic' in out).toBe(false);
  });
});
