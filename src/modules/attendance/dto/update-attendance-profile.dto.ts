import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Class-level validator: ít nhất một trong các field được liệt kê phải có giá trị (≠ undefined).
 * Dùng cho PATCH .../{recordId} (spec §5 #3) — phải gửi ≥1 field để cập nhật.
 */
function AtLeastOneDefined(fields: string[], options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'atLeastOneDefined',
      target: object.constructor,
      propertyName,
      options,
      constraints: [fields],
      validator: {
        validate(_: unknown, args: ValidationArguments) {
          const [allowed] = args.constraints as [string[]];
          const obj = args.object as Record<string, unknown>;
          return allowed.some((f) => obj[f] !== undefined);
        },
        defaultMessage(args: ValidationArguments) {
          const [allowed] = args.constraints as [string[]];
          return `At least one of: ${allowed.join(', ')} must be provided`;
        },
      },
    });
  };
}

/**
 * Input cho PATCH /api/v1/meetings/{meetingId}/attendance/{recordId} (spec §5 #3).
 * Service tính lại late flags nhưng KHÔNG đổi attendanceStatus (§1.4-9).
 */
export class UpdateAttendanceProfileDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Check-in time (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'checkInTime must be a valid ISO 8601 datetime' })
  checkInTime?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Check-out time (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'checkOutTime must be a valid ISO 8601 datetime' })
  checkOutTime?: string;

  @ApiPropertyOptional({
    description: 'Reason/note, max 1000 chars',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'note cannot exceed 1000 characters' })
  @AtLeastOneDefined(['checkInTime', 'checkOutTime', 'note'])
  note?: string;
}
