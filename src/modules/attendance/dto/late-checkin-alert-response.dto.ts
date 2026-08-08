import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PartialFailureItem {
  @ApiProperty({ description: 'ID user gửi cảnh báo thất bại' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Lý do gửi cảnh báo thất bại cho user này' })
  @IsString()
  reason: string;
}

export class LateCheckinAlertResponseDto {
  @ApiProperty({ description: 'ID cuộc họp đã trigger cảnh báo trễ điểm danh' })
  @IsUUID()
  meetingId: string;

  @ApiProperty({ description: 'Trạng thái xử lý trigger cảnh báo' })
  @IsString()
  status: string;

  @ApiProperty({ description: 'Tổng số người tham dự đã được kiểm tra điểm danh' })
  @IsNumber()
  totalParticipantsChecked: number;

  @ApiProperty({ description: 'Số cảnh báo trễ điểm danh đã gửi thành công' })
  @IsNumber()
  alertsSent: number;

  @ApiProperty({ description: 'true nếu đã gửi cảnh báo tổng hợp cho host' })
  @IsBoolean()
  hostAlertSent: boolean;

  @ApiPropertyOptional({
    type: [PartialFailureItem],
    description: 'Danh sách user gửi cảnh báo thất bại (nếu có)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartialFailureItem)
  @IsOptional()
  partialFailures?: PartialFailureItem[];
}
