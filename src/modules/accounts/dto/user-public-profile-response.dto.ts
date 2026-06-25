export class PublicProfileDepartmentDto {
  id: string;
  departmentName: string;
}

export class UserPublicProfileResponseDto {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  department: PublicProfileDepartmentDto | null;
  avatarUrl: string | null;
}
