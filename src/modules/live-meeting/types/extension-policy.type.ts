/**
 * ExtensionPolicy interface cho UC-IMM-02.
 * Định nghĩa cấu hình policy được load từ system_configs.
 */
export interface ExtensionPolicy {
  allowedExtensionMinutes: number[];
  maxExtensionCountPerMeeting: number;
  maxTotalExtensionMinutesPerMeeting: number;
}

/**
 * Default fallback policy khi không tìm thấy config trong system_configs.
 */
export const DEFAULT_EXTENSION_POLICY: ExtensionPolicy = {
  allowedExtensionMinutes: [15, 30, 60],
  maxExtensionCountPerMeeting: 2,
  maxTotalExtensionMinutesPerMeeting: 60,
};
