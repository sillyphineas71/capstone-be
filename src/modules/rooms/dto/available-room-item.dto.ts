import { RoomStatus } from '../entities/room.entity.js';

/**
 * 1 dong ket qua GET /rooms/available. Field naming theo dung contract FE yeu
 * cau (Docs/Nam_Sent/backend_api_requirements_available_rooms.md muc 2),
 * "hasScreen" map tu rooms.has_display.
 */
export class AvailableRoomItemDto {
  id: string;
  roomName: string;
  roomCode: string;
  capacity: number;
  status: RoomStatus;
  siteName: string | null;
  areaName: string | null;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasScreen: boolean;
}
