import { IsInt, IsISO8601, IsNotEmpty, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query cho GET /rooms/available (yeu cau FE, xem
 * Docs/Nam_Sent/backend_api_requirements_available_rooms.md).
 * startTime/endTime bat buoc; minCapacity tuy chon. Mo cho moi user da dang
 * nhap, khong yeu cau permission rieng (giong SearchRoomsQueryDto).
 */
export class AvailableRoomsQueryDto {
  @IsNotEmpty({ message: 'startTime la bat buoc' })
  @IsISO8601(
    { strict: true },
    { message: 'startTime phai dung dinh dang ISO-8601 co timezone' },
  )
  startTime: string;

  @IsNotEmpty({ message: 'endTime la bat buoc' })
  @IsISO8601(
    { strict: true },
    { message: 'endTime phai dung dinh dang ISO-8601 co timezone' },
  )
  endTime: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minCapacity phai la so nguyen' })
  @Min(1, { message: 'minCapacity phai tu 1 tro len' })
  minCapacity?: number;
}
