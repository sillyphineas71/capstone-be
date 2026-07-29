import { ParseUUIDPipe, UnprocessableEntityException } from '@nestjs/common';

/**
 * Factory returns a ParseUUIDPipe that throws 422 VALIDATION_ERROR
 * when the UUID is invalid — matching spec.md §2.3 step 3.
 */
export function biometricSubmissionIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new UnprocessableEntityException({
        success: false,
        message: 'Invalid UUID format for faceProfileId.',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
        path: '/api/v1/admin/biometric-submissions/{faceProfileId}',
      }),
  });
}
