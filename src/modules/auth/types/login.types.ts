export interface AuthUserSummary {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
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
