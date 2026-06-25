import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ description: 'Trang hiện tại' })
  page: number;

  @ApiProperty({ description: 'Số bản ghi mỗi trang' })
  limit: number;

  @ApiProperty({ description: 'Tổng số bản ghi' })
  total: number;

  @ApiProperty({ description: 'Tổng số trang' })
  totalPages: number;
}
