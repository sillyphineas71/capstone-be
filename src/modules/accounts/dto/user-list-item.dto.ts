import { ApiProperty } from '@nestjs/swagger';

export class UserListItemDto {
  @ApiProperty({ description: 'UUID người dùng' })
  id: string;

  @ApiProperty({ description: 'Họ tên đầy đủ' })
  fullName: string;

  @ApiProperty({ description: 'Email' })
  email: string;

  @ApiProperty({
    description: 'Mã nhân viên',
    required: false,
    nullable: true,
  })
  employeeCode?: string | null;
}
