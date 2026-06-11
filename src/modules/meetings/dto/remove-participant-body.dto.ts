import { IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { RemoveScope } from '../types/remove-scope.type.js';

export class RemoveParticipantBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsEnum(RemoveScope)
  scope?: RemoveScope;
}
