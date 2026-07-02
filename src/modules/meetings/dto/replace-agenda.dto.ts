import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { AgendaItemDto } from './agenda-item.dto.js';

export class ReplaceAgendaDto {
  @IsArray({ message: 'items ph\u1ea3i l\u00e0 m\u1ed9t m\u1ea3ng' })
  @ArrayMinSize(0, { message: 'items kh\u00f4ng \u0111\u01b0\u1ee3c null' })
  @ValidateNested({ each: true })
  @Type(() => AgendaItemDto)
  items: AgendaItemDto[];
}
