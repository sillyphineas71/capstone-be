export interface PasswordResetOtpSession {
  otpHash: string;
  attempts: number;
  createdAt: string;
}

export interface OtpValidationResult {
  isValid: boolean;
  error?: 'EXPIRED_OR_NOT_FOUND' | 'ATTEMPTS_EXCEEDED' | 'INCORRECT';
  remainingAttempts?: number;
}
