import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentEntity } from './entities/department.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { RoleEntity } from './entities/role.entity.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { UserRoleEntity } from './entities/user-role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { FaceProfileEntity } from './entities/face-profile.entity.js';
import { UsersController } from './controllers/users.controller.js';
import { DepartmentsController } from './controllers/departments.controller.js';
import { UsersService } from './services/users.service.js';
import { DepartmentsService } from './services/departments.service.js';
import { PasswordGeneratorService } from './services/password-generator.service.js';
import { IsDepartmentCodeUniqueConstraint } from './validators/is-department-code-unique.validator.js';
import { IsDepartmentNameUniqueConstraint } from './validators/is-department-name-unique.validator.js';
import { NoEmojiOrControlConstraint } from './validators/no-emoji-or-control.validator.js';
import { AdministrationModule } from '../administration/administration.module.js';

/**
 * AccountsModule quáº£n lÃ½ táº¥t cáº£ entities thuá»™c domain Identity & Access:
 * - DepartmentEntity (departments)
 * - UserEntity (users)
 * - RoleEntity (roles)
 * - PermissionEntity (permissions)
 * - UserRoleEntity (user_roles)
 * - RolePermissionEntity (role_permissions)
 * - FaceProfileEntity (face_profiles)
 *
 * CÃ¡c module khÃ¡c cáº§n dÃ¹ng entities nÃ y pháº£i import AccountsModule.
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
    AdministrationModule,
  ],
  controllers: [UsersController, DepartmentsController],
  providers: [
    UsersService,
    PasswordGeneratorService,
    DepartmentsService,
    IsDepartmentCodeUniqueConstraint,
    IsDepartmentNameUniqueConstraint,
    NoEmojiOrControlConstraint,
  ],
  exports: [TypeOrmModule, UsersService, PasswordGeneratorService, DepartmentsService],
})
export class AccountsModule {}

