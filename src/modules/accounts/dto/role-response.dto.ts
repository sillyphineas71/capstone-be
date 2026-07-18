export class RoleResponseDto {
  id: string;
  roleCode: string;
  roleName: string;
  description: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
