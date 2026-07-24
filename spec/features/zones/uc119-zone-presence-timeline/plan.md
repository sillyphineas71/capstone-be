# ZPT-001 — plan.md (UC-119 Zones / SAVP: timeline & thời gian lưu lại theo khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ZPT-001 cùng lượt với spec. THÊM controller/service/dto vào module `campus-dashboard` đã scaffold ở UC-126 — KHÔNG tạo module mới, KHÔNG DDL. | Toàn bộ |

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
  5. `if (events.length === 0) return {events: [], personDataAvailable: null, totalDurationSeconds: null, ongoing: false, message: 'Không có dữ liệu hiện diện trong khoảng thời gian này.'};`
  6. `const personDataAvailable = userId ? true : events.some(e => e.userId !== null);`
  7. `if (userId) { const {totalDurationSeconds, ongoing} = this.pairEnterExit(events); return {events: this.toDto(events), personDataAvailable, totalDurationSeconds, ongoing}; }`
  8. `return {events: this.toDto(events), personDataAvailable, totalDurationSeconds: null, ongoing: false};`
- `private pairEnterExit(events: ZonePresenceEventEntity[]): {totalDurationSeconds: number; ongoing: boolean}` — duyệt tuần tự (đã `ORDER BY eventTime ASC`), giữ biến `pendingEnter: Date | null`; gặp `eventType='enter'` → set `pendingEnter = eventTime` (nếu đang có `pendingEnter` cũ chưa đóng, GHI ĐÈ — enter mới nhất thắng, mirror log "chỉ 1 phiên đang mở tại 1 thời điểm"); gặp `eventType='exit'` VÀ có `pendingEnter` → cộng `(exitTime - pendingEnter) / 1000` vào tổng, reset `pendingEnter = null`; kết thúc vòng lặp, nếu `pendingEnter !== null` → `ongoing = true` (KHÔNG cộng vào tổng).
- `private validateRange(from: Date, to: Date): void` — `to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000` → throw `BadRequestException({code: 'INVALID_TIMELINE_RANGE', message: 'Khoảng thời gian tối đa 31 ngày'})`.

## 4. DTO
```
src/modules/campus-dashboard/dto/query-zone-timeline.dto.ts       (from, to: ISO date string bắt buộc; userId?: UUID optional)
src/modules/campus-dashboard/dto/zone-timeline-response.dto.ts    (events: TimelineEventDto[], personDataAvailable, totalDurationSeconds, ongoing, message?)
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
- `pairEnterExit`: cặp đơn giản 1 enter+1 exit; nhiều cặp liên tiếp; enter cuối không có exit → `ongoing=true`, không cộng tổng; enter mới đè enter cũ chưa đóng (2 enter liên tiếp không exit ở giữa).
- `getTimeline`: zone không tồn tại → 404; range >31 ngày → 400; rỗng → EX1 message; có `userId` → gọi đúng `pairEnterExit`; không `userId` → `totalDurationSeconds=null`; `personDataAvailable=false` khi toàn bộ event `userId=NULL`.
- Coverage **≥80%** file mới.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (bao gồm cả UC-126 cũ, KHÔNG hồi quy); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: residual §6 spec.md (ghép cặp chỉ trong tập kết quả, không mở rộng ra ngoài range).

## 10. Kỷ luật
- **DATA-01**: KHÔNG ghi `zone_presence_events`, tính ghép cặp TẠM trong request.
- KHÔNG tự code UC-120/121/126 ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-126 xong). KHÔNG tự code.
