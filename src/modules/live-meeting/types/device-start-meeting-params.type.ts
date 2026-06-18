/**
 * Tham số cho internal service startMeetingFromDeviceCheckIn (AF1).
 * Được module iot/attendance gọi sau khi chuẩn hóa raw event từ thiết bị.
 */
export interface DeviceStartMeetingParams {
  /** ID thiết bị trong iot_devices */
  deviceId: string;

  /** ID phòng liên quan (thường là room_id từ device mapping) */
  roomId: string;

  /** User ID được nhận diện từ thiết bị (host của meeting) */
  recognizedUserId: string;

  /** Nguồn kích hoạt: luôn là 'device' cho AF1 */
  sourceType: 'device';
}
