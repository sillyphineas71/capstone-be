import { IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';
import { RemoveScope } from '../types/remove-scope.type.js';

export class RemoveExternalParticipantBodyDto {
  @IsOptional()
  @IsString({ message: 'reason phải là chuỗi ký tự' })
  @MaxLength(1000, { message: 'reason tối đa 1000 ký tự' })
  reason?: string;

  @IsOptional()
  @IsEnum(RemoveScope, {
    message: 'scope chỉ nhận giá trị instance hoặc series',
  })
  scope?: RemoveScope;
}
