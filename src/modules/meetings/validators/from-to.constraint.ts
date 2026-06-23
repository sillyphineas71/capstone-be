import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'FromTo', async: false })
export class FromToConstraint implements ValidatorConstraintInterface {
  validate(toValue: unknown, args: ValidationArguments): boolean {
    const fromValue = (args.object as Record<string, unknown>)[
      args.constraints[0]
    ];
    if (!fromValue || !toValue) {
      return true;
    }
    const from = new Date(fromValue as string | Date);
    const to = new Date(toValue as string | Date);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return false;
    }
    return from.getTime() <= to.getTime();
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property}: from phải <= to`;
  }
}
