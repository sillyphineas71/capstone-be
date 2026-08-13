import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** OQ-2: trạng thái biển — đúng 2 giá trị. */
export type VehicleStatus = 'active' | 'disabled';

export const VEHICLE_STATUSES: VehicleStatus[] = ['active', 'disabled'];

/**
 * UpdateVehicleStatusDto (VPM-001 / UC2) — body PATCH /:id/status (enable/disable).
 * VAL-01: `@IsIn(['active','disabled'])` — ngoài enum → 400.
 */
export class UpdateVehicleStatusDto {
  @ApiProperty({
    description: 'Trạng thái mới của biển số',
    enum: VEHICLE_STATUSES,
  })
  @IsIn(VEHICLE_STATUSES)
  status: VehicleStatus;
}
