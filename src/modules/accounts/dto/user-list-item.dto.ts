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

  // [FIX 2026-08-17] Chỉ tính face_profiles.status='active' (ảnh ĐÃ DUYỆT, dùng được
  // để enroll — mirror FaceProfileService.getPortraitBytes()). KHÁC ngữ nghĩa với
  // UserDetailResponseDto.hasFaceProfile (endpoint GET /users/:id, tính CẢ profile
  // pending_review/revoked/rejected/disabled) — 2 field cùng tên nhưng khác điều
  // kiện, cố ý: ở đây dùng để cảnh báo FE "ảnh có dùng được để nhận diện không".
  @ApiProperty({
    description:
      'Người dùng có ảnh khuôn mặt ĐÃ DUYỆT (status=active) hay chưa — dùng để cảnh báo trước khi thêm participant chưa có ảnh nhận diện được',
  })
  hasFaceProfile: boolean;
}
