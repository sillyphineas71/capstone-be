export interface TeamPresenceTodayDto {
  presentCount: number;
  totalCount: number;
}

export interface OnTimeRateThisWeekDto {
  rate: number;
  sampleSize: number;
}

export interface TeamZoneSecurityAlertsDto {
  value: null;
  /** CDB-RS-001 spec §2.8: không có mapping zone↔team đáng tin cậy — luôn 'not_available'. */
  note: 'not_available';
}

export interface ManagerSummaryResponseDto {
  teamPresenceToday: TeamPresenceTodayDto;
  pendingMeetingRequestsCount: number;
  onTimeRateThisWeek: OnTimeRateThisWeekDto;
  teamZoneSecurityAlerts: TeamZoneSecurityAlertsDto;
}
