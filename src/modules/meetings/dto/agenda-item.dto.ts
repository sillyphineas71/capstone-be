import {
  IsOptional,
  IsUUID,
  IsNotEmpty,
  IsString,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';

export class AgendaItemDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsNotEmpty({ message: 'Ti\u00eau \u0111\u1ec1 agenda kh\u00f4ng \u0111\u01b0\u1ee3c \u0111\u1ec3 tr\u1ed1ng' })
  @IsString({ message: 'Ti\u00eau \u0111\u1ec1 ph\u1ea3i l\u00e0 chu\u1ed7i k\u00fd t\u1ef1' })
  @MaxLength(255, { message: 'Ti\u00eau \u0111\u1ec1 t\u1ed1i \u0111a 255 k\u00fd t\u1ef1' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'M\u00f4 t\u1ea3 t\u1ed1i \u0111a 2000 k\u00fd t\u1ef1' })
  description?: string;

  @IsOptional()
  @IsUUID('4')
  ownerId?: string | null;

  @IsNotEmpty({ message: 'Th\u1eddi l\u01b0\u1ee3ng d\u1ef1 ki\u1ebfn kh\u00f4ng \u0111\u01b0\u1ee3c \u0111\u1ec3 tr\u1ed1ng' })
  @IsInt({ message: 'Th\u1eddi l\u01b0\u1ee3ng d\u1ef1 ki\u1ebfn ph\u1ea3i l\u00e0 s\u1ed1 nguy\u00ean' })
  @Min(1, { message: 'Th\u1eddi l\u01b0\u1ee3ng d\u1ef1 ki\u1ebfn ph\u1ea3i l\u1edbn h\u01a1n 0' })
  plannedDurationMinutes: number;
}
