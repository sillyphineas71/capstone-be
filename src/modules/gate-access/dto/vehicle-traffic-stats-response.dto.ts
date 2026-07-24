import { VehicleTrafficStatsSummaryDto } from './vehicle-traffic-stats-summary.dto.js';
import { VehicleTrafficStatsBucketDto } from './vehicle-traffic-stats-bucket.dto.js';

/** VehicleTrafficStatsResponseDto (VTS-001 / UC-114) — response `data` của GET stats. */
export class VehicleTrafficStatsResponseDto {
  summary: VehicleTrafficStatsSummaryDto;
  series: VehicleTrafficStatsBucketDto[];
}
