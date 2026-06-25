import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const PERMISSION_CODE_REGEX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

@ValidatorConstraint({ name: 'isPermissionCodeFormat', async: false })
@Injectable()
export class IsPermissionCodeFormatConstraint implements ValidatorConstraintInterface {
  validate(value: string, _args: ValidationArguments): boolean {
    if (!value || typeof value !== 'string') return false;
    return PERMISSION_CODE_REGEX.test(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'permissionCode không đúng định dạng: chỉ chấp nhận chữ thường (a-z), số (0-9), underscore (_), dấu chấm (.) và phải có ít nhất một dấu chấm';
  }
}
