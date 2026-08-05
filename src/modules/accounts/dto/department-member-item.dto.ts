import { ApiProperty } from '@nestjs/swagger';

/**
 * ACCT-DEPT-MEMBERS-001 — Item trong danh sách nhân viên trực thuộc trực tiếp
 * 1 phòng ban (GET /departments/:id/members). Dùng để FE nạp nhanh cả phòng ban
 * vào participantUserIds khi đặt lịch họp.
 */
export class DepartmentMemberItemDto {
  @ApiProperty({ description: 'UUID người dùng' })
  id: string;

  @ApiProperty({ description: 'Mã nhân viên', nullable: true })
  employeeCode: string | null;

  @ApiProperty({ description: 'Họ tên đầy đủ' })
  fullName: string;

  @ApiProperty({ description: 'Email' })
  email: string;

  @ApiProperty({ description: 'Số điện thoại', nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ description: 'URL ảnh đại diện', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Chức danh/vị trí công việc trong phòng ban',
    nullable: true,
  })
  positionTitle: string | null;

  @ApiProperty({ description: 'Trạng thái làm việc (active | probation)' })
  employmentStatus: string;

  @ApiProperty({
    description:
      'true nếu người này là trưởng phòng (departments.manager_user_id)',
  })
  isDepartmentManager: boolean;
}
