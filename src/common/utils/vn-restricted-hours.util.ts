export interface RestrictedHoursWindow {
  allowFrom?: string | null;
  allowTo?: string | null;
}

/**
 * Phút-trong-ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh), ĐỘC LẬP với TZ runtime của
 * process Node — dùng Intl.DateTimeFormat thay vì Date#getHours()/getMinutes() (local
 * theo TZ máy chủ, sai nếu server chạy UTC). Dùng chung cho `isOutsideAllowedHoursVn`
 * (ingestion-time check) VÀ `RestrictedZoneIntrusionService#isWithinAllowedHours`
 * (đã fix cùng bug timezone, import trực tiếp hàm này — KHÔNG viết trùng).
 */
export function vnMinutesOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * true nếu `occurredAt` (giờ VN) nằm TRONG khung [allowFrom, allowTo]. Qua đêm
 * (allowFrom > allowTo, vd 22:00→06:00) → trong khung nếu >=from HOẶC <=to (mirror
 * logic restricted-zone-intrusion.service.ts, chỉ khác nguồn giờ).
 */
function isWithinAllowedHoursVn(
  hours: { allowFrom: string; allowTo: string },
  occurredAt: Date,
): boolean {
  const from = toMinutes(hours.allowFrom);
  const to = toMinutes(hours.allowTo);
  const current = vnMinutesOfDay(occurredAt);
  if (from <= to) {
    return current >= from && current <= to;
  }
  return current >= from || current <= to;
}

/**
 * Fail-closed (mirror RestrictedZoneIntrusionService#isViolation): KHÔNG có khung giờ
 * hợp lệ (thiếu allowFrom/allowTo) → LUÔN coi là ngoài giờ cho phép. Có khung giờ →
 * ngoài giờ khi KHÔNG rơi vào [allowFrom, allowTo] (giờ VN).
 */
export function isOutsideAllowedHoursVn(
  hours: RestrictedHoursWindow | null | undefined,
  occurredAt: Date,
): boolean {
  if (!hours?.allowFrom || !hours?.allowTo) return true;
  return !isWithinAllowedHoursVn(
    { allowFrom: hours.allowFrom, allowTo: hours.allowTo },
    occurredAt,
  );
}
