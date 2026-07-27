import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * ExportUsersQueryDto (BE-04) — `GET /api/v1/users/export`.
 *
 * [Phát hiện khi code, 2026-07-27] Không tái dùng nguyên `ListUsersQueryDto` (chỉ có
 * page/limit/search — DTO cho endpoint autocomplete `GET /users`). FE thật
 * (`UserManagement.jsx:360-365`, hàm `handleExportExcel`) gửi đúng 4 filter dưới đây,
 * khớp với các filter đang hiển thị trên màn quản trị (`fetchUsers` cùng file, dòng
 * 99-104) — mirror `ManageUsersQueryDto` (departmentId/roleId/search) nhưng thay
 * `accountStatus` (4 giá trị) bằng `locked` (boolean, tri-state qua optional) vì đó là
 * field FE thật sự gửi. Không có page/limit — export lấy toàn bộ (giới hạn trần an toàn
 * ở data service, xem UserExportDataService).
 */
export class ExportUsersQueryDto {
  @IsOptional()
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'departmentId phải là định dạng UUID' })
  departmentId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'roleId phải là định dạng UUID' })
  roleId?: string;

  /** true → chỉ tài khoản accountStatus='locked'; false → chỉ 'active'; bỏ trống → không lọc. */
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true'))
  @IsOptional()
  @IsBoolean({ message: 'locked phải là boolean' })
  locked?: boolean;
}
