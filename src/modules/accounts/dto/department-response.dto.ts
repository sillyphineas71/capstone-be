import { ApiProperty } from '@nestjs/swagger';

export class DepartmentResponseDto {
  @ApiProperty({ description: 'ID phòng ban', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Mã phòng ban (uppercase, đã normalize)' })
  departmentCode: string;

  @ApiProperty({ description: 'Tên phòng ban (đã trim)' })
  departmentName: string;

  @ApiProperty({ description: 'ID phòng ban cha', format: 'uuid', nullable: true })
  parentDepartmentId: string | null;

  @ApiProperty({ description: 'ID người quản lý', format: 'uuid', nullable: true })
  managerUserId: string | null;

  @ApiProperty({ description: 'Mô tả phòng ban', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Trạng thái hoạt động' })
  isActive: boolean;

  @ApiProperty({ description: 'Thời điểm tạo', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật', format: 'date-time' })
  updatedAt: Date;
}
