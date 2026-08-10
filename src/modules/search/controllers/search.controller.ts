import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { SearchService } from '../services/search.service.js';
import { QuerySearchDto } from '../dto/query-search.dto.js';
import { SEARCH_TYPES, SearchType } from '../constants/search-type.constant.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const SEARCH_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * SearchController (SRCH-01) — `GET /api/v1/search`.
 *
 * spec §1.1: CHỈ `JwtAuthGuard`, KHÔNG `PermissionsGuard`/`@RequirePermissions` — mỗi
 * `type` được lọc theo permission tương ứng ở tầng `SearchService`, không phải guard tĩnh.
 */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @UsePipes(SEARCH_PIPE)
  @ApiOperation({
    summary: 'Tìm kiếm toàn cục theo từ khóa, lọc theo loại đối tượng (mỗi loại tự lọc theo permission của user)',
  })
  async search(
    @CurrentUser() user: { userId: string },
    @Query() query: QuerySearchDto,
  ) {
    const types = this.parseTypes(query.types);
    const data = await this.service.search(user.userId, query.q, types);

    return {
      success: true,
      message: 'Search results retrieved successfully',
      data,
    };
  }

  /** R3: giá trị `types` không thuộc allowlist → 400, KHÔNG âm thầm bỏ qua. */
  private parseTypes(raw?: string): SearchType[] {
    if (!raw) return [...SEARCH_TYPES];

    const parsed = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    for (const t of parsed) {
      if (!(SEARCH_TYPES as readonly string[]).includes(t)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Loại tìm kiếm không hợp lệ: ${t}`,
        });
      }
    }

    return parsed as SearchType[];
  }
}
