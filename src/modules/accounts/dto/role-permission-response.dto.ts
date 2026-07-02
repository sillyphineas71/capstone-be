import { ApiProperty } from '@nestjs/swagger';
import { PermissionResponseDto } from './permission-response.dto.js';

export class RolePermissionResponseDto {
  @ApiProperty({
    description: 'ID của bản ghi role_permission',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({ description: 'ID của role', format: 'uuid' })
  roleId: string;

  @ApiProperty({ description: 'ID của permission', format: 'uuid' })
  permissionId: string;

  @ApiProperty({
    description: 'UUID của người gán (nullable)',
    format: 'uuid',
    nullable: true,
  })
  grantedBy: string | null;

  @ApiProperty({ description: 'Thời gian gán', format: 'date-time' })
  grantedAt: Date;

  @ApiProperty({ description: 'Thông tin chi tiết của permission' })
  permission: PermissionResponseDto;
}
