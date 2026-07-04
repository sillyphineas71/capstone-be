import {
  IsOptional,
  IsString,
  IsArray,
  IsUUID,
  IsInt,
  Min,
  Max,
  ValidateNested,
  IsIn,
  IsObject,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DecisionItemDto {
  @IsString()
  @MaxLength(500)
  decision: string;

  @IsOptional()
  @IsUUID('4')
  responsibleUserId?: string | null;
}

export class ActionItemDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  @IsOptional()
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high'])
  priority?: string = 'medium';
}

export class UpdateDraftMinutesDto {
  @IsInt()
  versionNo: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  minutesContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DecisionItemDto)
  decisionsJson?: DecisionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ActionItemDto)
  actionItemsJson?: ActionItemDto[];
}
