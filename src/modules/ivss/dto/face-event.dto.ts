import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * FaceEventDto (IVS-001 #36) — body webhook bridge → NestJS.
 * R4: channelId → number, utc → ISO-8601. SEC-01: imageBase64 KHÔNG log/audit.
 */
export class FaceEventDto {
  @ApiProperty({
    description: 'Loại sự kiện nhận diện khuôn mặt do bridge gửi',
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'ID kênh camera đã ghi nhận sự kiện' })
  @Type(() => Number)
  @IsInt()
  channelId: number;

  @ApiProperty({ description: 'UID của person do thiết bị IVSS nhận diện' })
  @IsString()
  @IsNotEmpty()
  personUid: string;

  @ApiProperty({ description: 'Thời điểm sự kiện xảy ra (ISO 8601)' })
  @IsISO8601()
  utc: string;

  @ApiPropertyOptional({
    description: 'Tên person do thiết bị trả về (nếu có)',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Độ tương đồng khuôn mặt (similarity score)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  similarity?: number;

  @ApiPropertyOptional({
    description: 'Hành động sự kiện (vd: enter/leave/seen)',
  })
  @IsOptional()
  @IsString()
  eventAction?: string;

  /** SEC-01: KHÔNG log/audit trường này — chỉ dùng để lưu snapshot. */
  @ApiPropertyOptional({
    description:
      'Ảnh snapshot dạng base64 (nếu bridge gửi) — KHÔNG được log/audit',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;
}
