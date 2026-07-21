import {
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  Min,
  Max,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FromToConstraint } from '../validators/from-to.constraint.js';

export class RoomBookingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'approved', 'active', 'completed', 'cancelled', 'released'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['scheduled', 'ad_hoc', 'extension', 'relocated'])
  bookingType?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  @Validate(FromToConstraint)
  to?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  @IsIn(['reserved_start_time', 'created_at', 'status'])
  sortBy?: string = 'reserved_start_time';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'desc';
}
