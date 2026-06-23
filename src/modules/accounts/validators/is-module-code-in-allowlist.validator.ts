import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { MODULE_CODE_ALLOWLIST } from '../constants/permission-module-allowlist.constant.js';

@ValidatorConstraint({ name: 'isModuleCodeInAllowlist', async: false })
@Injectable()
export class IsModuleCodeInAllowlistConstraint implements ValidatorConstraintInterface {
  validate(value: string, _args: ValidationArguments): boolean {
    if (!value || typeof value !== 'string') return false;
    return (MODULE_CODE_ALLOWLIST as unknown as string[]).includes(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return `moduleCode không hợp lệ. Các moduleCode được hỗ trợ: ${(MODULE_CODE_ALLOWLIST as unknown as string[]).join(', ')}`;
  }
}
