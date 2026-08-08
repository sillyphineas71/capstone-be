import { PendingRoomConflictDto } from './pending-room-conflict.dto.js';

export class CapacityWarning {
  roomCapacity: number;
  attendeeCount: number;
  message: string;
}

export class AvailableRoomDto {
  roomId: string;
  roomName: string;
  roomCode: string;
  capacity: number;
  location: string | null;
  equipmentFlags: string[];
  availabilityStatus: string;
  isCurrentRoom: boolean;
  capacityWarning: CapacityWarning | null;
  /** Nhóm D (2026-08-08) — cảnh báo mềm, không ảnh hưởng availabilityStatus. */
  pendingConflicts: PendingRoomConflictDto[];
}
