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
import { FaceProfileController } from './controllers/face-profile.controller.js';
import { AvatarController } from './controllers/avatar.controller.js';
import { AdminAvatarReviewController } from './controllers/admin-avatar-review.controller.js';
import { UsersService } from './services/users.service.js';
import { FaceProfileService } from './services/face-profile.service.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { RolePermissionsController } from './controllers/role-permissions.controller.js';
import { AvatarStatusService } from './services/avatar-status.service.js';
import { AvatarSubmissionService } from './services/avatar-submission.service.js';
import { AdminAvatarReviewService } from './services/admin-avatar-review.service.js';
import { DepartmentsService } from './services/departments.service.js';
import { PasswordGeneratorService } from './services/password-generator.service.js';
import { IsDepartmentCodeUniqueConstraint } from './validators/is-department-code-unique.validator.js';
import { IsDepartmentNameUniqueConstraint } from './validators/is-department-name-unique.validator.js';
import { NoEmojiOrControlConstraint } from './validators/no-emoji-or-control.validator.js';
import { PermissionsService } from './services/permissions.service.js';
import { RolePermissionsService } from './services/role-permissions.service.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * AccountsModule quÃ¡ÂºÂ£n lÃƒÂ½ tÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ entities thuÃ¡Â»â„¢c domain Identity & Access:
 * - DepartmentEntity (departments)
 * - UserEntity (users)
 * - RoleEntity (roles)
 * - PermissionEntity (permissions)
 * - UserRoleEntity (user_roles)
 * - RolePermissionEntity (role_permissions)
 * - FaceProfileEntity (face_profiles)
 *
 * CÃƒÂ¡c module khÃƒÂ¡c cÃ¡ÂºÂ§n dÃƒÂ¹ng entities nÃƒ y phÃ¡ÂºÂ£i import AccountsModule.
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
    AuthModule,
    NotificationsModule,
  ],
  controllers: [
    UsersController,
    DepartmentsController,
    PermissionsController,
    RolePermissionsController,
    FaceProfileController,
    AvatarController,
    AdminAvatarReviewController,
  ],
  providers: [
    UsersService,
    FaceProfileService,
    AvatarStatusService,
    AvatarSubmissionService,
    AdminAvatarReviewService,
    PermissionsService,
    RolePermissionsService,
    PasswordGeneratorService,
    DepartmentsService,
    IsDepartmentCodeUniqueConstraint,
    IsDepartmentNameUniqueConstraint,
    NoEmojiOrControlConstraint,
  ],
  exports: [
    TypeOrmModule,
    UsersService,
    FaceProfileService,
    PasswordGeneratorService,
    DepartmentsService,
  ],
})
export class AccountsModule {}

