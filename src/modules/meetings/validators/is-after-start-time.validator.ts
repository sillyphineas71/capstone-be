import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsAfterStartTime', async: false })
export class IsAfterStartTimeConstraint implements ValidatorConstraintInterface {
  validate(endTime: unknown, args: ValidationArguments): boolean {
    const startTimeValue = (args.object as Record<string, unknown>)[
      args.constraints[0]
    ];
    if (!startTimeValue || !endTime) {
      return true;
    }
    const start = new Date(startTimeValue as string | Date);
    const end = new Date(endTime as string | Date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return true;
    }
    return end.getTime() > start.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    return `Thời gian kết thúc phải sau thời gian bắt đầu`;
  }
}
