export class DepartmentInfoDto {
  id: string;
  departmentName: string;
}

export class DirectManagerInfoDto {
  id: string;
  fullName: string;
}

export class RoleInfoDto {
  id: string;
  roleCode: string;
  roleName: string;
}

export class UserDetailResponseDto {
  id: string;
  employeeCode: string | null;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  positionTitle: string | null;
  department: DepartmentInfoDto | null;
  directManager: DirectManagerInfoDto | null;
  accountStatus: string;
  employmentStatus: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: RoleInfoDto[];
  hasFaceProfile: boolean;
  createdAt: string;
}
