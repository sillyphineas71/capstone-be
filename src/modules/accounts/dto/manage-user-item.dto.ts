import { ApiProperty } from '@nestjs/swagger';

/**
 * UC-14 — Item trong danh sách tài khoản (endpoint quản trị GET /users/manage).
 * Giàu hơn UserListItemDto (autocomplete): kèm trạng thái, phòng ban, vai trò.
 */
export class ManageUserItemDto {
  @ApiProperty({ description: 'UUID người dùng' })
  id: string;

  @ApiProperty({ description: 'Họ tên đầy đủ' })
  fullName: string;

  @ApiProperty({ description: 'Email' })
  email: string;

  @ApiProperty({ description: 'Mã nhân viên', nullable: true })
  employeeCode: string | null;

  @ApiProperty({ description: 'Trạng thái tài khoản' })
  accountStatus: string;

  @ApiProperty({ description: 'UUID phòng ban', nullable: true })
  departmentId: string | null;

  @ApiProperty({
    description: 'Danh sách mã vai trò (roleCode) đang active',
    type: [String],
  })
  roles: string[];
}
