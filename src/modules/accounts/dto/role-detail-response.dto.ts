import { RoleResponseDto } from './role-response.dto.js';

export class RoleDetailResponseDto extends RoleResponseDto {
  assignedUserCount: number;
}
