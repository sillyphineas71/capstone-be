import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsFutureDate', async: false })
export class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' && !(value instanceof Date)) {
      return false;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    return date.getTime() > Date.now();
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} phải là thời điểm trong tương lai`;
  }
}
