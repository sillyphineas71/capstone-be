import { IsOptional, IsUUID } from 'class-validator';
import { Expose } from 'class-transformer';
import { ListGateAccessHistoryQueryDto } from './list-gate-access-history-query.dto.js';

/**
 * ListGateAccessHistoryAdminQueryDto (GAH-001 / UC-117) — query GET /gate-access/admin/history.
 * Mở rộng query own thêm `user_id`/`department_id` (BR1 SRS: chỉ Admin/Manager tra cứu người khác).
 */
export class ListGateAccessHistoryAdminQueryDto extends ListGateAccessHistoryQueryDto {
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @Expose({ name: 'department_id' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
