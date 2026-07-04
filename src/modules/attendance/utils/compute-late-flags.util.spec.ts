import { computeLateFlags } from './compute-late-flags.util.js';

describe('computeLateFlags (UC-B21 / spec §5.3 — no-grace)', () => {
  const start = new Date('2026-06-30T09:00:00.000Z');
  const end = new Date('2026-06-30T10:00:00.000Z');

  // ── Mốc 1: đúng giờ ──
  it('đúng giờ (checkInTime == startTime) → isLate=false, lateMinutes=0', () => {
    const r = computeLateFlags(start, start, null, null);
    expect(r.isLate).toBe(false);
    expect(r.lateMinutes).toBe(0);
  });

  it('đến sớm (checkInTime < startTime) → isLate=false, lateMinutes=0', () => {
    const before = new Date('2026-06-30T08:55:00.000Z');
    const r = computeLateFlags(before, start, null, null);
    expect(r.isLate).toBe(false);
    expect(r.lateMinutes).toBe(0);
  });

  // ── Mốc 2: trễ 1 giây → lateMinutes=1 ──
  it('trễ 1 giây → isLate=true, lateMinutes=1', () => {
    const late1s = new Date(start.getTime() + 1000);
    const r = computeLateFlags(late1s, start, null, null);
    expect(r.isLate).toBe(true);
    expect(r.lateMinutes).toBe(1);
  });

  // ── Mốc 3: trễ 90 giây → lateMinutes=2 ──
  it('trễ 90 giây → lateMinutes=2 (ceil 1.5)', () => {
    const late90s = new Date(start.getTime() + 90 * 1000);
    const r = computeLateFlags(late90s, start, null, null);
    expect(r.isLate).toBe(true);
    expect(r.lateMinutes).toBe(2);
  });

  // ── Mốc 4: leftEarly theo checkOutTime vs endTime ──
  it('checkOutTime < endTime → leftEarly=true', () => {
    const out = new Date('2026-06-30T09:45:00.000Z');
    const r = computeLateFlags(start, start, out, end);
    expect(r.leftEarly).toBe(true);
  });

  it('checkOutTime == endTime → leftEarly=false', () => {
    const r = computeLateFlags(start, start, end, end);
    expect(r.leftEarly).toBe(false);
  });

  it('checkOutTime > endTime → leftEarly=false', () => {
    const out = new Date('2026-06-30T10:15:00.000Z');
    const r = computeLateFlags(start, start, out, end);
    expect(r.leftEarly).toBe(false);
  });

  // ── Mốc 5: endTime=null → leftEarly=false dù có checkOutTime ──
  it('endTime=null → leftEarly=false (dù có checkOutTime)', () => {
    const out = new Date('2026-06-30T09:45:00.000Z');
    const r = computeLateFlags(start, start, out, null);
    expect(r.leftEarly).toBe(false);
  });

  it('checkOutTime=null → leftEarly=false', () => {
    const r = computeLateFlags(start, start, null, end);
    expect(r.leftEarly).toBe(false);
  });
});
