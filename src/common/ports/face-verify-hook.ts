/**
 * FACE_VERIFY_HOOK (FAT-001 / Face-access C) — port nối `iot` → `face-access`.
 *
 * Đặt ở `common` (leaf, không import module nào) để `iot` inject hook mà KHÔNG
 * import `face-access` → tránh circular dependency (NC-4). `face-access` là
 * `@Global()` và provide token này bằng `useExisting: FaceAttendanceService`.
 */
export interface FaceVerifyInput {
  /** iot_devices.id của Face Terminal gửi verify. */
  deviceId: string;
  /** Phòng gắn thiết bị (iot_devices.room_id), có thể null. */
  roomId: string | null;
  /** person_id thiết bị báo (= device_person_id/uid trong mapping). */
  personId: string | null;
  /** person_name thiết bị báo (= device_person_code = userId:meetingId). */
  personName: string | null;
  /** Thời điểm verify (đã parse sang Date). */
  verifyTime: Date;
}

export interface FaceVerifyHook {
  onVerify(input: FaceVerifyInput): Promise<void>;
}

/** Injection token cho hook verify → attendance. */
export const FACE_VERIFY_HOOK = Symbol('FACE_VERIFY_HOOK');
