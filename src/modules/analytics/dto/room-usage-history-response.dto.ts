export type SessionStatus =
  | 'completed'
  | 'no_show'
  | 'early_empty'
  | 'released'
  | 'cancelled_late'
  | 'cancelled'
  | 'not_started'
  | 'in_progress'
  | 'pending_evaluation';

export class RoomUsageHistorySessionDto {
  roomId: string;
  roomName: string;
  meetingId: string;
  meetingTitle: string;
  hostName: string;
  reservedStartTime: Date;
  reservedEndTime: Date;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  sessionStatus: SessionStatus;
}

export class RoomUsageHistorySummaryDto {
  totalReservedHours: number;
  totalActualHours: number | null;
  noShowCount: number;
  reservationUtilizationRate: number;
  roomOccupancyRate: number | null;
}

export class RoomUsageHistoryResponseDto {
  period: { from: string; to: string };
  summary: RoomUsageHistorySummaryDto;
  sessions: RoomUsageHistorySessionDto[];
}
