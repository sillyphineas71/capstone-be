import type { AvatarReviewStatus } from '../../../common/utils/avatar-status-resolver.util';

export interface AuthUserSummary {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  // ACCT-AVATAR-SUBMIT-001 (BR-016): field derived trạng thái avatar cho FE popup.
  avatarReviewStatus: AvatarReviewStatus;
  avatarRequired: boolean;
  shouldShowAvatarPopup: boolean;
  departmentId: string | null;
  roles: string[];
  permissions: string[];
}

export interface LoginSuccessData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUserSummary;
}

export interface RequestContextInfo {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuthenticatedUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  avatarUrl: string | null;
  departmentId: string | null;
  accountStatus: string;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}
