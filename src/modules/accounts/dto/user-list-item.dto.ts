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

  @ApiProperty({
    description: 'Đường dẫn ảnh đại diện của người dùng',
    example: 'https://storage.example.com/avatars/user.jpg',
    required: false,
    nullable: true,
  })
  avatarUrl?: string | null;
}
