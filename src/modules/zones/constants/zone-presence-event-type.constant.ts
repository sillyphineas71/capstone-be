/**
 * ZONE_PRESENCE_EVENT_TYPES (ZPE-001) ? ki?u s? ki?n hi?n di?n khu v?c.
 *
 * B?ng `zone_presence_events` l?u `event_type` d?ng varchar, KH?NG c? CHECK constraint
 * v? KH?NG c? PG enum (migration 20260721000005) ? ??y l? ch?t ch?n DUY NH?T cho gi? tr?
 * h?p l?.
 *
 * TODO: Ch?nh l?i comment theo chu?n d? ?n n?u c?n.
 *
 * - `appear`    ? camera ph?t hi?n m?t ng??i xu?t hi?n trong v?ng (UC-109)
 * - `disappear` ? ng??i r?i kh?i v?ng (UC-109)
 * - `count`     ? s? ki?n ??m s? ng??i, k?m occupancy_count (UC-110)
 *
 * Kh?c v?i `gate_access_logs.direction` (`enter`/`leave`), kh?ng n?n d?ng nh?m:
 * gate_access_logs bi?t CHI?U ?i qua ranh gi?i c?ng, zone_presence_events ch? bi?t
 * ng??i XU?T HI?N trong khung h?nh ? l??ng th?ng tin kh?c nhau.
 *
 * Mirror style `zone-type.constant.ts`: `as const` + `@IsIn`, KH?NG d?ng TS `enum`.
 */
export const ZONE_PRESENCE_EVENT_TYPES = [
  'appear',
  'disappear',
  'count',
] as const;

export type ZonePresenceEventType = (typeof ZONE_PRESENCE_EVENT_TYPES)[number];
