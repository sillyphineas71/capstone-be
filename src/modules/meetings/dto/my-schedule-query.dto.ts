import {
  IsEnum,
  IsDateString,
  IsOptional,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsIanaTimezoneConstraint } from '../validators/is-iana-timezone.validator.js';

export enum ScheduleView {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class MyScheduleQueryDto {
  @IsEnum(ScheduleView, { message: 'view phai la day, week hoac month' })
  view: ScheduleView;

  @IsDateString(
    {},
    {
      message:
        'from phai la ISO date string co offset (vd: 2026-06-08T00:00:00+07:00)',
    },
  )
  from: string;

  @IsDateString(
    {},
    {
      message:
        'to phai la ISO date string co offset (vd: 2026-06-08T00:00:00+07:00)',
    },
  )
  to: string;

  @IsOptional()
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string = 'Asia/Ho_Chi_Minh';

  @IsOptional()
  @IsEnum(['scheduled', 'in_progress', 'cancelled', 'completed'], {
    each: true,
    message: 'status khong hop le',
  })
  status?: string[];

  @IsOptional()
  @IsEnum(['organizer', 'host', 'attendee'], {
    message: 'role phai la organizer, host hoac attendee',
  })
  role?: 'organizer' | 'host' | 'attendee';

  @IsOptional()
  @IsUUID('4', { message: 'roomId phai la UUID hop le' })
  roomId?: string;

  @IsOptional()
  @MaxLength(200, { message: 'q khong duoc vuot qua 200 ky tu' })
  q?: string;
}
