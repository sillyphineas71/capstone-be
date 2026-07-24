export interface TrafficSeriesPointDto {
  zoneId: string;
  hourBucket: string;
  avgOccupancy: number;
  peakOccupancy: number;
}

export interface ZoneHeatmapDto {
  zoneId: string;
  zoneName: string;
  building: string | null;
  floor: string | null;
  avgOccupancy: number;
  peakOccupancy: number;
  peakAt: string | null;
  relativeDensity: number;
  /** BLOCKED (kế thừa UC-126 §2.1): LUÔN `null` cho tới khi `zones` có cột tọa độ thật. */
  coordinates: { lat: number; lng: number } | null;
}

export interface TrafficResponseDto {
  series: TrafficSeriesPointDto[];
  heatmap: ZoneHeatmapDto[];
}
