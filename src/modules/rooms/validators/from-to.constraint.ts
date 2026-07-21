import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'FromToConstraint', async: false })
export class FromToConstraint implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const from = obj['from'] as string | undefined;
    const to = obj['to'] as string | undefined;
    if (!from || !to) return true;
    if (isNaN(new Date(from).getTime()) || isNaN(new Date(to).getTime()))
      return true;
    return new Date(from) <= new Date(to);
  }
  defaultMessage(): string {
    return 'from phai <= to';
  }
}
