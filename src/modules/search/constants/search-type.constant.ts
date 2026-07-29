/**
 * SEARCH_TYPES (SRCH-01) — 5 loại resource hỗ trợ tìm kiếm tổng hợp.
 * Mirror pattern hằng số as-const của `gate-direction.constant.ts` (module `zones`).
 */
export const SEARCH_TYPES = [
  'zone',
  'device',
  'vehicle',
  'user',
  'meeting',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];
