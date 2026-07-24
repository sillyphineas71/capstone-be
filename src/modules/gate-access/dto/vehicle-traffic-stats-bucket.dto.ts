/** VehicleTrafficStatsBucketDto (VTS-001 / UC-114) — 1 phần tử `series`, theo `group_by`. */
export class VehicleTrafficStatsBucketDto {
  bucket: string;
  enter: number;
  leave: number;
  seen: number;
}
