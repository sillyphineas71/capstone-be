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
  accountStatus: string;
  mustChangePassword: boolean;
  roles: UserRoleResponseDto[];
  createdAt: Date;
}
