import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveMeetingRequestDto {
  @IsString({ message: 'decisionNote phải là chuỗi ký tự' })
  @IsOptional()
  @MaxLength(500, { message: 'decisionNote không được vượt quá 500 ký tự' })
  decisionNote?: string;
}
