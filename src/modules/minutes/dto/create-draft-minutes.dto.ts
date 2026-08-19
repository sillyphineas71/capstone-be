import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MeetingMinutesContentFormat } from '../entities/meeting-minutes.entity.js';

const CONTENT_FORMAT_VALUES = Object.values(MeetingMinutesContentFormat);

export class CreateDraftMinutesDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  /**
   * 'blank' (trang trắng, chỉ soạn tự do) hoặc 'template' (structured —
   * decisions/action items). Mặc định 'template' nếu không truyền.
   */
  @IsOptional()
  @IsIn(CONTENT_FORMAT_VALUES)
  contentFormat?: MeetingMinutesContentFormat;
}
