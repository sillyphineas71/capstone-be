export class RoomComparisonItemDto {
  roomId: string;
  roomName: string;
  bookedHours: number;
  actualHours: number | null;
  reservationUtilizationRate: number;
  roomOccupancyRate: number | null;
  hasActualData: boolean;
}

export class RoomUsageSummaryDto {
  reservationUtilizationRate: number;
  roomOccupancyRate: number | null;
  totalBookedHours: number;
  actualUsedHours: number | null;
}

export class RoomUsageDashboardResponseDto {
  period: { from: string; to: string };
  summary: RoomUsageSummaryDto;
  rooms: RoomComparisonItemDto[];
  trend: { date: string; meetingCount: number }[];
}

export class HeatmapBucketDto {
  hourOfDay: number; // 0-23
  actualMinutes: number;
}

export class RoomDetailMeetingDto {
  meetingId: string;
  title: string;
  organizerName: string;
  reservedStartTime: Date;
  reservedEndTime: Date;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  status: string;
}

export class RoomDetailResponseDto {
  room: {
    roomId: string;
    roomName: string;
    siteName: string | null;
    areaName: string | null;
    capacity: number;
  };
  period: { from: string; to: string };
  bookedHours: number;
  actualHours: number | null;
  reservationUtilizationRate: number;
  roomOccupancyRate: number | null;
  hasActualData: boolean;
  heatmap: HeatmapBucketDto[];
  meetings: RoomDetailMeetingDto[];
}
