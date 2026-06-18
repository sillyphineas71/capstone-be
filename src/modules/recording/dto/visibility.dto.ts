import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type VisibilityAction = 'hide' | 'soft_delete';

/** Body ẩn/xóa-mềm media_file (UC-123). */
export class VisibilityDto {
  @IsIn(['hide', 'soft_delete'])
  action: VisibilityAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
