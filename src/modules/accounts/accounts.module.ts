import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentEntity } from './entities/department.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { RoleEntity } from './entities/role.entity.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { UserRoleEntity } from './entities/user-role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { FaceProfileEntity } from './entities/face-profile.entity.js';

/**
 * AccountsModule quản lý tất cả entities thuộc domain Identity & Access:
 * - DepartmentEntity (departments)
 * - UserEntity (users)
 * - RoleEntity (roles)
 * - PermissionEntity (permissions)
 * - UserRoleEntity (user_roles)
 * - RolePermissionEntity (role_permissions)
 * - FaceProfileEntity (face_profiles)
 *
 * Các module khác cần dùng entities này phải import AccountsModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DepartmentEntity,
      UserEntity,
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      RolePermissionEntity,
      FaceProfileEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AccountsModule {}
