import { ApiProperty } from '@nestjs/swagger';

export class PermissionResponseDto {
  @ApiProperty({ description: 'ID của permission', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Mã quyền (unique), định dạng module.action' })
  permissionCode: string;

  @ApiProperty({ description: 'Tên hiển thị của quyền' })
  permissionName: string;

  @ApiProperty({ description: 'Mã module' })
  moduleCode: string;

  @ApiProperty({ description: 'Mã hành động' })
  actionCode: string;

  @ApiProperty({ description: 'Mô tả chi tiết về quyền', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Trạng thái hoạt động' })
  isActive: boolean;

  @ApiProperty({ description: 'Thời điểm tạo', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    description: 'Thời điểm cập nhật gần nhất',
    format: 'date-time',
  })
  updatedAt: Date;
}
