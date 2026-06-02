export function maskSensitiveMetadata(
  json: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!json || typeof json !== 'object') {
    return json || null;
  }

  // Create a deep copy to avoid mutating the original object
  const maskedJson = Array.isArray(json) ? [...json] : { ...json };

  const sensitiveKeywords = ['secret', 'token', 'password'];

  for (const key in maskedJson) {
    if (Object.prototype.hasOwnProperty.call(maskedJson, key)) {
      const lowerKey = key.toLowerCase();

      const isSensitive = sensitiveKeywords.some((keyword) =>
        lowerKey.includes(keyword),
      );

      const isAllowedExclusion = lowerKey.endsWith('_last4');

      if (isSensitive && !isAllowedExclusion) {
        maskedJson[key] = '***';
      } else if (
        typeof maskedJson[key] === 'object' &&
        maskedJson[key] !== null
      ) {
        maskedJson[key] = maskSensitiveMetadata(maskedJson[key]);
      }
    }
  }

  return maskedJson;
}
