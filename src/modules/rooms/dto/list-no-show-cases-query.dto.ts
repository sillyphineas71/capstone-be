import { IsEnum, IsOptional, IsUUID, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { NoShowDetectionStatus } from '../entities/no-show-case.entity.js';

/**
 * Query cho GET /no-show-cases (liệt kê case giám sát phòng).
 * Mirror ListDepartmentsQueryDto (page/limit, default 20, max 100).
 */
export class ListNoShowCasesQueryDto {
  @Type(() => Number)
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  @IsOptional()
  limit?: number = 20;

  @IsOptional()
  @IsEnum(NoShowDetectionStatus, {
    message:
      'status phải là một trong: risk, confirmed, warning_sent, released, dismissed, resolved',
  })
  status?: NoShowDetectionStatus;

  @IsOptional()
  @IsUUID('4', { message: 'roomId phải là UUID hợp lệ' })
  roomId?: string;
}
