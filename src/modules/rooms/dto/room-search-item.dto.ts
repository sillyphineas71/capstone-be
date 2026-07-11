import { RoomStatus, RoomType } from '../entities/room.entity.js';

/**
 * 1 dong ket qua tim kiem phong (UC-ROOM-04).
 * KHONG chua field van hanh noi bo (occupancyCount, lastPresenceAt, noShowStatus,
 * currentBooking) — nhung field do chi danh cho RoomStatusService (RMS-001, admin/manager).
 */
export class RoomSearchItemDto {
  roomId: string;
  roomCode: string;
  roomName: string;
  siteName: string | null;
  areaName: string | null;
  locationDescription: string | null;
  capacity: number;
  roomType: RoomType;
  currentStatus: RoomStatus;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasDisplay: boolean;
  allowRecording: boolean;
}
