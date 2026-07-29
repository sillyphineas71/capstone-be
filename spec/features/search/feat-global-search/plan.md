# SRCH-01 — plan.md (Tìm kiếm tổng hợp đa nguồn — Global Search)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo plan cùng lượt với spec. Module `search` MỚI, 0 migration (không cần permission mới), 0 entity mới. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- Xác nhận export path chính xác 5 entity (T0 bắt buộc verify lại vì có thể chưa export public từ index module):
  `ZoneEntity` (`src/modules/zones/entities/zone.entity.ts`), `IoTDeviceEntity` (`src/modules/iot/entities/iot-device.entity.ts`), `VehicleRegistrationEntity` (`src/modules/anpr/entities/vehicle-registration.entity.ts`), `UserEntity` (`src/modules/accounts/entities/user.entity.ts`), `MeetingEntity` (`src/modules/meetings/entities/meeting.entity.ts`).
- Xác nhận `AuthzReadRepository` export từ `AuthModule` (đã dùng ở `meetings.service.ts`, `login.service.ts` — inject trực tiếp qua constructor, KHÔNG cần thêm gì ở `AuthModule`).
- Xác nhận `normalizePlate` (`src/modules/anpr/utils/normalize-plate.ts`) — dùng khi search `type=vehicle` để chuẩn hóa `q` trước khi ILIKE `plateNumber` (mirror `vehicle-registration.service.ts:147`), tránh so sánh sai lệch định dạng biển số.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (6 quyết định: response gom theo type + loại hẳn type không có quyền, `types` allowlist, query song song không UNION, label/subtitle từng type, permission map hard-code, module tự forFeature). Constitution đầy đủ ở spec §5.

## 2. Entity — không đổi, không migration
0 thay đổi schema, 0 migration (KHÔNG cần permission mới — dùng lại 5 permission-code đã tồn tại).

## 3. Module mới — `search`
```
src/modules/search/search.module.ts
```
- `imports: [AuthModule, TypeOrmModule.forFeature([ZoneEntity, IoTDeviceEntity, VehicleRegistrationEntity, UserEntity, MeetingEntity])]`.
- `controllers: [SearchController]`.
- `providers: [SearchService]`.
- `exports: []`.

## 4. Repository — KHÔNG tạo repository riêng
Query trực tiếp trong `SearchService` qua 5 `@InjectRepository` — mỗi type chỉ 1 query đơn giản (`find` hoặc `createQueryBuilder` + ILIKE + `take(10)`), không đủ phức tạp để tách lớp repository riêng (mirror mức độ đơn giản của các service nhỏ khác trong repo, ví dụ `NotificationReadStateService` không có repository riêng).

## 5. Service — `SearchService`
```
src/modules/search/services/search.service.ts
```
- Constant `TYPE_PERMISSION_MAP: Record<SearchType, string>` (spec §2.5).
- `async search(userId: string, q: string, types: SearchType[]): Promise<SearchResponseDto>`:
  1. `const { permissions } = await this.authzRepo.getEffectiveRolesAndPermissions(userId);`
  2. `const allowedTypes = types.filter(t => permissions.includes(TYPE_PERMISSION_MAP[t]));` (spec R4 — loại hẳn type không có quyền TRƯỚC KHI query, không lãng phí query rồi bỏ kết quả).
  3. `const results = await Promise.all(allowedTypes.map(t => this.searchByType(t, q)));`
  4. Trả `{ query: q, types: results }` (mỗi phần tử `{type, items}}`).
- `private async searchByType(type: SearchType, q: string): Promise<{type: SearchType; items: SearchResultItemDto[]}>` — switch theo `type`, gọi đúng repo tương ứng:
  - `zone`: `zoneRepo.find({where: [{zoneName: ILike('%'+q+'%'), deletedAt: IsNull()}, {zoneCode: ILike('%'+q+'%'), deletedAt: IsNull()}], take: 10})` → map `{type, id, label: zoneName, subtitle: `${zoneCode} · ${zoneType}`}`.
  - `device`: `deviceRepo.find({where: [{deviceName: ILike(...)}, {deviceCode: ILike(...)}], take: 10})` (KHÔNG filter `deletedAt` — spec R6) → map `{label: deviceName, subtitle: deviceCode}`.
  - `vehicle`: `normalizePlate(q)` trước → `vehicleRepo.find({where: [{plateNumber: ILike('%'+normalized+'%'), deletedAt: IsNull()}], take: 10})` → map `{label: plateRaw, subtitle: vehicleType}`.
  - `user`: `userRepo.find({where: [{fullName: ILike(...), deletedAt: IsNull()}, {email: ILike(...), deletedAt: IsNull()}, {employeeCode: ILike(...), deletedAt: IsNull()}], take: 10})` → map `{label: fullName, subtitle: email}`.
  - `meeting`: `meetingRepo.find({where: [{title: ILike(...), deletedAt: IsNull()}], take: 10})` → map `{label: title, subtitle: meetingCode}`.

## 6. Pure functions — không cần (logic đơn giản, giữ trong service)

## 7. DTO
```
src/modules/search/dto/query-search.dto.ts        (q: string @MinLength(2), types?: string — parse allowlist)
src/modules/search/dto/search-response.dto.ts      (SearchResultItemDto, SearchTypeResultDto, SearchResponseDto)
```
`QuerySearchDto`: `q` bắt buộc `@IsString() @MinLength(2)`; `types` optional `@IsOptional() @IsString()` — parse thủ công trong controller/service (split `,`, validate allowlist `['zone','device','vehicle','user','meeting']`, ném `BadRequestException` nếu có giá trị lạ — mirror validate thủ công, KHÔNG dùng enum-array decorator phức tạp cho 1 field đơn giản).

## 8. Controller
```
src/modules/search/controllers/search.controller.ts
```
- `GET /api/v1/search` — `@UseGuards(JwtAuthGuard)` (CHỈ JWT, KHÔNG `PermissionsGuard`/`@RequirePermissions` — spec §1.1), `@CurrentUser() user`, `@Query() query: QuerySearchDto` → validate `types` allowlist (400 nếu sai) → gọi `service.search(user.userId, query.q, parsedTypes)` → trả `{success, message, data}`.

## 9. Migration — KHÔNG cần
0 permission mới, 0 DDL.

## 10. File list
### Net-new (7 file)
- `src/modules/search/search.module.ts`
- `src/modules/search/services/search.service.ts` (+ `.spec.ts`)
- `src/modules/search/controllers/search.controller.ts` (+ `.spec.ts`)
- `src/modules/search/dto/query-search.dto.ts`
- `src/modules/search/dto/search-response.dto.ts`
### Modified (1 file)
- `src/app.module.ts` (đăng ký `SearchModule`)
> Tổng **7 net-new + 1 modified**. 0 entity, 0 migration.

## 11. Test (mock repo/AuthzReadRepository — KHÔNG DB thật)
- `search()`: type không có permission → loại hẳn khỏi response (R4), KHÔNG gọi query cho type đó; type có permission nhưng 0 kết quả → `{type, items: []}` (R5, phân biệt R4).
- `searchByType('device', ...)`: KHÔNG áp `deletedAt` vào where (R6) — test riêng bằng cách kiểm tra where clause không chứa field này.
- `searchByType('zone'|'vehicle'|'user'|'meeting', ...)`: PHẢI áp `deletedAt: IsNull()` (R7).
- `searchByType('vehicle', ...)`: gọi `normalizePlate(q)` trước khi build where.
- Controller: `q` < 2 ký tự → 400 (test DTO validation); `types` chứa giá trị lạ → 400.
- Coverage ≥80% file mới.

## 12. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/search` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.

## 13. Kỷ luật
- **DATA-01**: 100% READ-ONLY.
- **SEC-01**: mọi type PHẢI có mặt trong `TYPE_PERMISSION_MAP` trước khi query — thiếu map = ẩn nhầm (an toàn), KHÔNG được "mặc định cho phép" nếu thiếu map (fail-closed).
- **ARCH-02**: KHÔNG import `ZonesModule`/`IotModule`/`AnprModule`/`AccountsModule`/`MeetingsModule`.
- KHÔNG thêm relevance ranking, cache, pagination, deep-link (NGOÀI scope spec §3).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
