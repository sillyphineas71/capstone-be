import { IsOptional, IsUUID, IsString, MaxLength } from 'class-validator';
import { Expose } from 'class-transformer';
import { ListGateAccessLogsQueryDto } from './list-gate-access-logs-query.dto.js';

/**
 * AdminListGateAccessLogsQueryDto (GAL-001 / UC-107) — query GET /api/v1/admin/gate-access-logs.
 *
 * `extends` DTO route user ⇒ kế thừa page/limit/from/to/direction/zone_id, cộng 2 filter
 * chủ nhân/biển: `user_id` (exact) và `plate` (service normalize + so exact).
 *
 * ⚠ ĐÍNH CHÍNH SEC-01 của lớp cha: comment lớp cha "KHÔNG nhận user_id/plate" CHỈ đúng cho
 * route USER. Lớp con NÀY CÓ `user_id`/`plate`, nhưng chỉ phục vụ route admin đã qua
 * @RequirePermissions('zones.gate_log.read'). Route user vẫn dùng lớp cha và fold cứng userId
 * từ JWT — hai field này không bao giờ tới được route user.
 */
export class AdminListGateAccessLogsQueryDto extends ListGateAccessLogsQueryDto {
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;
}
