# ZPT-001 — plan.md (UC-119 Zones / SAVP: timeline & thời gian lưu lại theo khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ZPT-001 cùng lượt với spec. THÊM controller/service/dto vào module `campus-dashboard` đã scaffold ở UC-126 — KHÔNG tạo module mới, KHÔNG DDL. | Toàn bộ |
| 2026-07-27 | **Đính chính P1 (A.2)**: bỏ `pairEnterExit`/`totalDurationSeconds`/`ongoing` (thuật toán dùng nhầm `enter`/`exit` — giá trị không tồn tại trong `zone_presence_events`), thay bằng `sightingCount` (đếm event). Xem spec.md đính chính cùng ngày, `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md` §2A. | §1, §3, §4, §7-8 |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. **Điều kiện tiên quyết: `../uc126-campus-dashboard/` xong trước** (cần module `campus-dashboard` + `CampusDashboardRepository` đã tồn tại).

## 0. RECON bổ sung
- Xác nhận `campus-dashboard.module.ts`/`CampusDashboardRepository` đã tồn tại thật (từ UC-126).
- 0 migration DDL, 1 migration seed permission mới.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (6 quyết định: endpoint đọc thô không bucket, userId filter tùy chọn, ghép cặp FIFO trong tập kết quả, EX1 200-rỗng, range max 31 ngày, không cache). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
0 thay đổi schema.

## 3. Service mới — `ZonePresenceTimelineService`
```
src/modules/campus-dashboard/services/zone-presence-timeline.service.ts
```
- Constructor: `@InjectRepository(ZoneEntity)`, `@InjectRepository(ZonePresenceEventEntity)`.
- `async getTimeline(zoneId, from, to, userId?): Promise<TimelineResponseDto>`:
  1. `const zone = await this.zoneRepo.findOne({where: {id: zoneId, deletedAt: IsNull()}}); if (!zone) throw new NotFoundException({code: 'ZONE_NOT_FOUND', ...});`
  2. `this.validateRange(from, to);` (throw `400 INVALID_TIMELINE_RANGE` nếu > 31 ngày).
  3. `const where: FindOptionsWhere<ZonePresenceEventEntity> = {zoneId, eventTime: Between(from, to)}; if (userId) where.userId = userId;`
  4. `const events = await this.presenceRepo.find({where, order: {eventTime: 'ASC'}});`
  5. `if (events.length === 0) return {events: [], personDataAvailable: null, sightingCount: null, message: 'Không có dữ liệu hiện diện trong khoảng thời gian này.'};`
  6. `const personDataAvailable = userId ? true : events.some(e => e.userId !== null);`
  7. `return {events: this.toDto(events), personDataAvailable, sightingCount: userId ? events.length : null};`
- **[Đính chính 2026-07-27]** `pairEnterExit` đã bị loại bỏ — `enter`/`exit` không phải giá trị hợp lệ của `zone_presence_events.event_type` (thật ra là `appear`/`disappear`/`count`, xem `zones/constants/zone-presence-event-type.constant.ts`). `sightingCount` thay thế toàn bộ logic ghép cặp.
- `private validateRange(from: Date, to: Date): void` — `to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000` → throw `BadRequestException({code: 'INVALID_TIMELINE_RANGE', message: 'Khoảng thời gian tối đa 31 ngày'})`.

## 4. DTO
```
src/modules/campus-dashboard/dto/query-zone-timeline.dto.ts       (from, to: ISO date string bắt buộc; userId?: UUID optional)
src/modules/campus-dashboard/dto/zone-timeline-response.dto.ts    (events: TimelineEventDto[], personDataAvailable, sightingCount, message?)
```

## 5. Controller — thêm route vào module `campus-dashboard`
```
src/modules/campus-dashboard/controllers/zone-presence-timeline.controller.ts
```
- `GET /api/v1/campus-dashboard/zones/:zoneId/timeline` — `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('campus_dashboard.timeline.read')`, `@Param('zoneId', ParseUUIDPipe) zoneId`, `@Query() query: QueryZoneTimelineDto`.
- Đăng ký thêm vào `controllers: []` của `campus-dashboard.module.ts` (mảng đã có `DashboardOverviewController` từ UC-126, THÊM `ZonePresenceTimelineController` — KHÔNG tạo module mới).

## 6. Migration mới — seed permission
```
src/database/migrations/20260723000009-SeedCampusDashboardTimelinePermission.ts
```
- Mirror migration UC-126 (`...000008`), seed `campus_dashboard.timeline.read`, role Admin/Manager.

## 7. File list
### Net-new (7 file)
- `src/modules/campus-dashboard/services/zone-presence-timeline.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/zone-presence-timeline.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/dto/query-zone-timeline.dto.ts`
- `src/modules/campus-dashboard/dto/zone-timeline-response.dto.ts`
- `src/database/migrations/20260723000009-SeedCampusDashboardTimelinePermission.ts`
### Modified (1 file)
- `src/modules/campus-dashboard/campus-dashboard.module.ts` (thêm controller/provider vào mảng có sẵn)
> Tổng **7 net-new + 1 modified**. 0 entity, 1 migration (seed permission only).

## 8. Test (mock repo — KHÔNG DB)
- `getTimeline`: zone không tồn tại → 404; range >31 ngày → 400; rỗng → EX1 message (`sightingCount: null`); có `userId` → `sightingCount = events.length`; không `userId` → `sightingCount=null`; `personDataAvailable=false` khi toàn bộ event `userId=NULL`; `personDataAvailable=true` khi có event có `userId`.
- Coverage **≥80%** file mới.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (bao gồm cả UC-126 cũ, KHÔNG hồi quy); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: residual §6 spec.md (ghép cặp chỉ trong tập kết quả, không mở rộng ra ngoài range).

## 10. Kỷ luật
- **DATA-01**: KHÔNG ghi `zone_presence_events`, tính ghép cặp TẠM trong request.
- KHÔNG tự code UC-120/121/126 ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-126 xong). KHÔNG tự code.
