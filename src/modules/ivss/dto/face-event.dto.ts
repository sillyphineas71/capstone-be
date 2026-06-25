import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * FaceEventDto (IVS-001 #36) — body webhook bridge → NestJS.
 * R4: channelId → number, utc → ISO-8601. SEC-01: imageBase64 KHÔNG log/audit.
 */
export class FaceEventDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @Type(() => Number)
  @IsInt()
  channelId: number;

  @IsString()
  @IsNotEmpty()
  personUid: string;

  @IsISO8601()
  utc: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  similarity?: number;

  @IsOptional()
  @IsString()
  eventAction?: string;

  @IsOptional()
  @IsString()
  imageBase64?: string;
}
