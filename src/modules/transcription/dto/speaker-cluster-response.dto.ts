import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * GA-23 — GET /api/v1/transcripts/:transcriptId/speaker-clusters.
 * Mapping hiện tại của cụm (nếu đã gán từ trước — feature này ghi đè được).
 */
export class SpeakerClusterCurrentMappingDto {
  @ApiProperty() mappedUserId!: string | null;
  @ApiProperty() mappingSource!: string;
  @ApiPropertyOptional() displayName?: string;
}

export class SpeakerClusterDto {
  @ApiProperty({ description: 'Nhãn cụm (vd Speaker_1)' })
  speakerLabel!: string;

  @ApiProperty({ description: 'Tổng thời lượng nói (ms)' })
  totalSpeakingMs!: number;

  @ApiProperty({ description: 'Số segment thuộc cụm này' })
  segmentCount!: number;

  @ApiProperty({
    description: 'Text của segment dài nhất — để Host đọc thử biết ai đang nói',
  })
  sampleText!: string;

  @ApiProperty({
    description:
      'Mốc thời gian (ms trong audio) của segment mẫu, để FE nghe thử',
  })
  sampleStartMs!: number;

  @ApiPropertyOptional({ type: SpeakerClusterCurrentMappingDto })
  currentMapping?: SpeakerClusterCurrentMappingDto;
}
