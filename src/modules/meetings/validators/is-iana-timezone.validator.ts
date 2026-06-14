import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Custom validator that checks if a timezone string is a valid IANA timezone.
 * Uses Intl.supportedValuesOf('timeZone') available in modern Node.js/Chrome/V8.
 */
@ValidatorConstraint({ name: 'IsIanaTimezone', async: false })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  private readonly validTimezones: Set<string>;

  constructor() {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      this.validTimezones = new Set(timezones);
    } catch {
      // Fallback for older environments
      this.validTimezones = new Set([
        'Asia/Ho_Chi_Minh',
        'Asia/Bangkok',
        'Asia/Singapore',
        'UTC',
        'Asia/Tokyo',
        'Asia/Seoul',
        'America/New_York',
        'America/Chicago',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Australia/Sydney',
        'Pacific/Auckland',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Dubai',
        'Asia/Kolkata',
      ]);
    }
  }

  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return this.validTimezones.has(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} phai la mot IANA timezone hop le (vd: Asia/Ho_Chi_Minh)`;
  }
}
