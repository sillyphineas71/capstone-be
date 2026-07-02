import { ApiProperty } from '@nestjs/swagger';

export class AssignPermissionsResponseDto {
  @ApiProperty({
    description: 'Danh sách permission mới được gán thành công',
    type: [String],
  })
  assigned: string[];

  @ApiProperty({
    description: 'Danh sách permission đã tồn tại trước đó (skip)',
    type: [String],
  })
  skippedAlreadyAssigned: string[];

  @ApiProperty({
    description: 'Danh sách permission bị lặp trong request (skip)',
    type: [String],
  })
  skippedDuplicatedInRequest: string[];
}
