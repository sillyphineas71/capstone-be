import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * QueryUserAuditLogsDto — phân trang cho GET /api/v1/users/:userId/audit-logs.
 *
 * Không có filter nào khác ngoài phân trang; điều kiện lọc đối tượng
 * (entity_type='users' AND entity_id=:userId) nằm ở path param + repository.
 */
export class QueryUserAuditLogsDto {
  @ApiPropertyOptional({
    description: 'Trang hiện tại (bắt đầu từ 1)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
