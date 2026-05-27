export function normalizeMacAddress(
  mac: string | undefined | null,
): string | null {
  if (!mac) return null;
  const trimmed = mac.trim();
  if (trimmed.length === 0) return null;

  return trimmed.replace(/-/g, ':').toUpperCase();
}
