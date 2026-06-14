import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { DepartmentEntity } from '../entities/department.entity.js';

@ValidatorConstraint({ name: 'isDepartmentCodeUnique', async: true })
@Injectable()
export class IsDepartmentCodeUniqueConstraint implements ValidatorConstraintInterface {
  constructor(
    @InjectRepository(DepartmentEntity)
    private readonly departmentRepo: Repository<DepartmentEntity>,
  ) {}

  async validate(value: string, _args: ValidationArguments): Promise<boolean> {
    if (!value || typeof value !== 'string') return false;
    const count = await this.departmentRepo.count({
      where: { departmentCode: value, deletedAt: IsNull() },
    });
    return count === 0;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Mã phòng ban này đã được sử dụng';
  }
}
