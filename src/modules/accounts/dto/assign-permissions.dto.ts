import { IsArray, ArrayNotEmpty, IsUUID, ArrayUnique } from 'class-validator';

export class AssignPermissionsDto {
  @IsArray({ message: 'permissionIds phải là một mảng' })
  @ArrayNotEmpty({ message: 'permissionIds không được để trống' })
  @ArrayUnique({ message: 'permissionIds không được chứa giá trị trùng lặp' })
  @IsUUID('4', {
    each: true,
    message: 'Mỗi permissionId phải là UUID hợp lệ (phiên bản 4)',
  })
  permissionIds: string[];
}
