export class UserRoleResponseDto {
  id: string;
  roleCode: string;
  roleName: string;
}

export class UserResponseDto {
  id: string;
  employeeCode: string | null;
  email: string;
  fullName: string;
  departmentId: string | null;
  accountStatus: string;
  mustChangePassword: boolean;
  accountExpiresAt: Date | null;
  roles: UserRoleResponseDto[];
  createdAt: Date;
}
