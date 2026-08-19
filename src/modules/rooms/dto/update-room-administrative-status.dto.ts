import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /rooms/:roomId/administrative-status — admin dat/go trang thai
 * CHU DONG cho phong (maintenance/inactive), tach bach khoi trang thai
 * occupied/reserved/available von duoc tinh real-time (xem
 * RoomSearchService/RoomStatusService.computeStatus). Gui 'available' de
 * go override hien tai.
 */
export class UpdateRoomAdministrativeStatusDto {
  @IsIn(['available', 'maintenance', 'inactive'], {
    message: "status phai la 'available', 'maintenance' hoac 'inactive'",
  })
  status: 'available' | 'maintenance' | 'inactive';

  @IsOptional()
  @IsString({ message: 'reason phai la chuoi ky tu' })
  @MaxLength(500, { message: 'reason toi da 500 ky tu' })
  reason?: string;
}
