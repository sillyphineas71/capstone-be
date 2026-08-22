import { EquipmentType } from '../entities/equipment.entity.js';

/**
 * 1 dong ket qua "phong da dang ky co thiet bi (has_camera/has_microphone/
 * has_display) nhung chua duoc gan Equipment thuc te tuong ung" — dung cho
 * banner nhac nho Business Admin (GET /equipments/rooms-missing-equipment).
 */
export class RoomEquipmentGapItemDto {
  roomId: string;
  roomCode: string;
  roomName: string;
  missingTypes: EquipmentType[];
  missingTypeLabels: string[];

  constructor(data: RoomEquipmentGapItemDto) {
    Object.assign(this, data);
  }
}
