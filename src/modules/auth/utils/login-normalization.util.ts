export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hasOnlyAllowedLoginFields(payload: Record<string, unknown>): boolean {
  const allowedFields = ['email', 'password'];
  return Object.keys(payload).every((key) => allowedFields.includes(key));
}
