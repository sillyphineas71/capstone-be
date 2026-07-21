# Research - Xem danh sach toan bo booking phong hien tai

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi research cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-20 | Cap nhat Manager scope decision thanh da giai quyet, sua loi format "r" thua | Technology Decisions, Risks & Mitigations |
| 2026-07-21 | Fix service file name: RoomBookingsService (room-bookings.service.ts) thay vi ambiguous | Chua co, Technology Decisions |

---

## Codebase Analysis

### 1. Module hien tai

| Module | Trang thai | Lien quan |
|--------|-----------|-----------|
| rooms/ | Da implement (controller + service + entities) | Chua RoomBookingEntity - entity chinh |
| accounts/ | UserEntity san sang | Relation bookedByUser, approvedByUser |
| meetings/ | MeetingEntity san sang | Relation meeting |

### 2. Entities co san va dung duoc ngay

- **RoomBookingEntity**: Day du fields (bookingCode, meetingId, roomId, bookingType, reservedStartTime, reservedEndTime, status, bookedBy, approvedBy, approvedAt, cancellationReason) + enum BookingType (scheduled, ad_hoc, extension, relocated) + enum RoomBookingStatus (pending, approved, active, completed, cancelled, released)
- **RoomEntity**: Dung cho relation room
- **MeetingEntity**: Dung cho relation meeting
- **UserEntity**: Dung cho relation bookedByUser, approvedByUser

### 3. Patterns co san

| Pattern | Implementation |
|---------|---------------|
| Controller | rooms.controller.ts voi module prefix |
| Guard | JwtAuthGuard + PermissionsGuard + @RequirePermissions() |
| Response format | { success, message, data, meta } |
| Error format | NestJS exception filter voi { success, message, error: { code, details } } |
| Pagination | Query params page, limit, sortBy, sortOrder |
| Sort allowlist | Validate truoc khi dung orderBy |
| DTO validation | class-validator + class-transformer |
| Permission check | AuthzReadRepository.getEffectiveRolesAndPermissions(userId) - returns { roles: string[], permissions: string[] } |

### 4. Chua co (can tao moi)

- **RoomBookingsController** - chua co controller rieng
- **Room booking list endpoint** - chua co GET /room-bookings
- **Method findRoomBookings()** trong RoomBookingsService (file moi room-bookings.service.ts)
- **DTOs** cho query params + response
- **Permission seed** cho room.booking.read

---

## Technology Decisions

| Decision | Chon | Rationale |
|----------|------|-----------|
| Module placement | rooms module | Entity da co, pattern co san |
| Controller | Controller rieng room-bookings.controller.ts | Resource rieng biet |
| Query approach | TypeORM QueryBuilder + LEFT JOIN | Tranh N+1, index-friendly |
| Pagination | skip + take + getManyAndCount() | Pattern du an |
| Sort allowlist | Mang string ['reserved_start_time','created_at','status'] | Validate truoc orderBy |
| Scope filtering | QueryBuilder .where() - da giai quyet | Manager scope = bookedBy.directManagerId OR bookedBy.department.managerUserId, tai su dung rule FR-032 cua feat-pending-meeting-requests |
| Permission | @RequirePermissions('room.booking.read') | Guard check permission; permission MOI can seed |
| Null relation | LEFT JOIN + null check + map DTO | Tranh loi null pointer |
| Audit log | Khong ghi | Feature read-only |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| N+1 query | QueryBuilder LEFT JOIN + select fields cu the |
| SortBy injection | Allowlist validation truoc orderBy |
| Manager scope filtering | Da giai quyet: directManagerId + department.managerUserId (xem spec.md muc 1.5) |
| Large result set | Pagination bat buoc, limit <= 100 |
| Permission room.booking.read chua seed | Migration seed rieng trong implementation phase |

