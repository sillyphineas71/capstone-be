/** Dùng chung cho mọi list API trong module `alerts` (mirror anpr/PaginationMeta, KHÔNG import chéo module). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
