export interface GateTrafficTodayDto {
  entriesToday: number;
  exitsToday: number;
}

export interface SecurityAlertsBySeverityDto {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface ZoneOccupancySummaryDto {
  totalCount: number;
  zonesWithDataCount: number;
  totalZoneCount: number;
}

export interface BusinessAdminSummaryResponseDto {
  gateTrafficToday: GateTrafficTodayDto;
  securityAlertsBySeverity: SecurityAlertsBySeverityDto;
  zoneOccupancy: ZoneOccupancySummaryDto;
  vehicleControlHitsToday: number;
}
