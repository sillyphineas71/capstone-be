/**
 * Tính cờ trễ / về sớm cho điểm danh thủ công (UC-B21, spec §5.3).
 * Hàm THUẦN — KHÔNG phụ thuộc Nest; dùng chung cho createManual + updateProfile.
 *
 * Quy tắc no-grace (khớp read-side đã verify attendance.service.ts:284-286):
 *   isLate      = checkInTime > startTime
 *   lateMinutes = late ? max(1, ceil(diffMs / 60000)) : 0
 *   leftEarly   = checkOutTime != null && endTime != null && checkOutTime < endTime
 *               (endTime null → leftEarly = false)
 */
export interface LateFlags {
  isLate: boolean;
  lateMinutes: number;
  leftEarly: boolean;
}

export function computeLateFlags(
  checkInTime: Date,
  startTime: Date,
  checkOutTime: Date | null,
  endTime: Date | null,
): LateFlags {
  const isLate = checkInTime.getTime() > startTime.getTime();
  const lateMinutes = isLate
    ? Math.max(
        1,
        Math.ceil((checkInTime.getTime() - startTime.getTime()) / 60000),
      )
    : 0;

  const leftEarly =
    checkOutTime !== null &&
    endTime !== null &&
    checkOutTime.getTime() < endTime.getTime();

  return { isLate, lateMinutes, leftEarly };
}
