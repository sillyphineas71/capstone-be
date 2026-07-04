export class AverageDurationPointDto {
  period: string;
  plannedAverageMinutes: number | null;
  actualAverageMinutes: number | null;
  completedMeetingCount: number;
}

export class AverageDurationSummaryDto {
  plannedAverageMinutes: number | null;
  actualAverageMinutes: number | null;
  completedMeetingCount: number;
}

export class MeetingAverageDurationResponseDto {
  period: { from: string; to: string };
  summary: AverageDurationSummaryDto;
  series: AverageDurationPointDto[];
}
