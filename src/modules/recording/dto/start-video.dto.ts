import { IsUUID, IsOptional, IsString } from 'class-validator';

/**
 * StartVideoDto (REC-002) — body POST start-video.
 * v1 ép mp4 + local: outputFormat/storageProvider nhận nhưng BỎ QUA.
 */
export class StartVideoDto {
  @IsUUID('4')
  cameraDeviceId: string;

  @IsOptional()
  @IsString()
  outputFormat?: string;

  @IsOptional()
  @IsString()
  storageProvider?: string;
}
