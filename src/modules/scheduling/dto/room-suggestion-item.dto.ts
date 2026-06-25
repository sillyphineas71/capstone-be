/**
 * Một phòng họp trong danh sách đề xuất.
 */
export class RoomSuggestionItemDto {
  /** ID phòng (uuid) */
  roomId: string;

  /** Mã phòng (vd: R101) */
  roomCode: string;

  /** Tên phòng hiển thị */
  roomName: string;

  /** Sức chứa phòng */
  capacity: number;

  /** Điểm phù hợp 0-100 (100 = capacity khớp attendeeCount) */
  score: number;

  /** Luôn true — phòng khả dụng */
  available: boolean;

  /** Thiết bị khả dụng đáp ứng yêu cầu (vd: ["camera", "microphone"]) */
  matchedFeatures: string[];

  /** Cảnh báo nếu thiết bị yêu cầu nhưng không có */
  warnings: string[];
}
