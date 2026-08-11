/**
 * DTOs cho ROOM-VIEW-DETAIL-001: Xem chi tiet 1 phong hop (admin only).
 * Ref: spec.md §4.1, FR-RVD-001-003 ... FR-RVD-001-006, plan.md §5.
 * Chi la response DTO (khong co @IsX validation — khong phai input DTO).
 */

/** FR-RVD-001-006: createdBy/updatedBy — chi tra {userId, fullName}, KHONG toan bo user object. */
export class RoomDetailUserRefDto {
  userId: string;
  fullName: string;
}

/**
 * Booking ref — dung cho ca occupancyStatus.currentBooking va upcomingBookings.
 * Ref: FR-RVD-001-004, FR-RVD-001-005.
 */
export class RoomDetailBookingRefDto {
  bookingId: string | null;
  meetingId: string | null;
  title: string | null;
  hostName: string | null;
  reservedStartTime: Date | string | null;
  reservedEndTime: Date | string | null;
}

/**
 * occupancyStatus — compose tu RoomStatusService.getRoomStatus() (BR-1, BR-5).
 * KHONG merge administrativeStatus vao day (D-5, BR-3).
 */
export class RoomDetailOccupancyStatusDto {
  currentBooking: RoomDetailBookingRefDto | null;
  occupancyCount: number | null;
  lastPresenceAt: Date | string | null;
  /** detection_status rut gon tu no_show_case moi nhat; null neu khong co. */
  noShowStatus: string | null;
}

/**
 * RoomDetailResponseDto — response day du cho GET /rooms/:roomId.
 * Ref: spec.md §4.1, FR-RVD-001-003/004/005/006.
 */
export class RoomDetailResponseDto {
  roomId: string;
  roomCode: string;
  roomName: string;
  siteName: string | null;
  areaName: string | null;
  locationDescription: string | null;
  capacity: number;
  roomType: string;
  /** BR-3: rooms.current_status nguyen trang — khong suy dien lai tu occupancy. */
  administrativeStatus: string;
  hasCamera: boolean;
  hasMicrophone: boolean;
  hasDisplay: boolean;
  allowRecording: boolean;
  layoutJson: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** BR-6: null neu entity.createdBy la null. */
  createdBy: RoomDetailUserRefDto | null;
  /** BR-6: null neu entity.updatedBy la null. */
  updatedBy: RoomDetailUserRefDto | null;
  /** Ref: FR-RVD-001-004. */
  occupancyStatus: RoomDetailOccupancyStatusDto;
  /** BR-4: toi da 5 booking status approved/active co reserved_start_time > now(), sort ASC; [] neu khong co. */
  upcomingBookings: RoomDetailBookingRefDto[];
}
