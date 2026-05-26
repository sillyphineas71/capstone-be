import { Injectable } from '@nestjs/common';
import { AuthUserSummary, LoginSuccessData } from '../types/login.types';

@Injectable()
export class LoginResponsePresenter {
  success(data: LoginSuccessData): { success: true; data: LoginSuccessData; meta: Record<string, never> } {
    return {
      success: true,
      data,
      meta: {},
    };
  }

  userSummary(user: AuthUserSummary): AuthUserSummary {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      departmentId: user.departmentId,
      roles: user.roles,
      permissions: user.permissions,
    };
  }
}
