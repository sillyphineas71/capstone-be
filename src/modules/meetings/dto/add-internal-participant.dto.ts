import {
  IsUUID,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsString,
} from 'class-validator';

export class AddInternalParticipantDto {
  @IsUUID('4', { message: 'userId phải là định dạng UUID' })
  @IsNotEmpty({ message: 'userId không được để trống' })
  userId!: string;

  @IsOptional()
  @IsBoolean({ message: 'overrideWarnings phải là boolean' })
  overrideWarnings?: boolean;

  @IsOptional()
  @IsString({ message: 'warningToken phải là chuỗi ký tự' })
  warningToken?: string;
}
