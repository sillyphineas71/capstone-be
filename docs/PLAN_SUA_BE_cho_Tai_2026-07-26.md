# PLAN SỬA BE — người nhận: Tài — 2026-07-26

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo mới: plan sửa BE theo bản đồ `FE_BE_API_MAP_2026-07-26.md` — 12 mục (6 CHẶN, 1 NGHIỆP VỤ, 5 NỢ), mọi mục kèm bằng chứng `path:dòng` trên code sống | Toàn bộ file |
| 2026-07-26 (v2) | Sửa DUY NHẤT mục BE-05: làm rõ chỉ có HAI route `GET` trùng (`live-meeting.controller.ts:458` + `attendance.controller.ts:36`); `manual-attendance.controller.ts` là POST/PATCH — KHÔNG trùng, KHÔNG được đụng; thêm quy trình gỡ 4 bước (so dữ liệu trước, khác thì đổi path không xoá). Cập nhật dòng checklist BE-05 cho nhất quán | Mục BE-05 + 1 dòng checklist A.4 |

> **Nguồn:** `docs/FE_BE_API_MAP_2026-07-26.md` + xác minh lại từng dòng trên code sống ngày 2026-07-26.
> **Quy ước bắt buộc khi thực thi (CLAUDE.md / constitution):**
> - Endpoint mới PHẢI seed permission bằng **migration** trong `src/database/migrations/` cùng commit với controller (CLAUDE.md §5.5 quy tắc 4 — folder `seeds/` không có runner) — nếu không FE ăn 403.
> - Mọi endpoint mutating phải có auth (SEC-02) và cơ chế idempotency (ARCH-03); response theo format §8 CLAUDE.md; OpenAPI decorator đầy đủ (ENG-02).
> - Route mới là public phải document lý do (SEC-02).
>
> **Ký hiệu:** 🚧 = mục CHẶN Nam (Nam không hoàn thành màn tương ứng tới khi mục này xong).

---

## A.1 🔴 NHÓM CHẶN — route thiếu/lỗi khiến FE 404

### BE-01 🚧 Thêm `POST /auth/refresh` — **ƯU TIÊN SỐ 1, chặn MỌI màn hình**

**Mô tả:** FE có cơ chế token-rotation: khi request ăn 401, wrapper tự gọi `POST /auth/refresh` với body `{ refreshToken }` và kỳ vọng `{ success, data: { accessToken, refreshToken } }` — `FE_SmarTracking/src/utils/request.js:97-111`. BE **không có** endpoint này → access token hết hạn là người dùng bị văng đăng nhập.

**Hiện trạng BE (đã xác minh):**
- `auth.controller.ts` chỉ có: login `:53`, logout `:91`, password-reset/request `:136`, password-reset/confirm `:168`, change-password `:199`, me `:253` (`src/modules/auth/controllers/auth.controller.ts`).
- Login **đã phát** refreshToken và trả về FE: `src/modules/auth/services/login.service.ts:123-126` (generate), `:199` (return).
- Hạ tầng đã có sẵn nhưng đang bỏ không:
  - `TokenService.generateRefreshToken()` — `src/modules/auth/services/token.service.ts:24-32` (ký bằng `AUTH_REFRESH_TOKEN_SECRET`, TTL từ `auth-config.service.ts:19-21` — `AUTH_REFRESH_TOKEN_TTL_SECONDS`).
  - `TokenService.hashRefreshToken()` — `token.service.ts:34-36` — hiện **không nơi nào trong production code gọi** (chỉ spec gọi: `token.service.spec.ts:13`, `login.service.spec.ts:32`). Tức refresh token phát ra nhưng không được lưu/đối chiếu ở đâu.

**Đề xuất (2 phương án — Tài quyết, KHÔNG tự quyết thay):**
- **PA-1 (stateless, ít việc hơn):** `POST /auth/refresh` public (`isPublic` — document lý do theo SEC-02). Verify chữ ký + hạn của refreshToken bằng `AUTH_REFRESH_TOKEN_SECRET`; check `jti` không nằm trong JWT blacklist Redis (cơ chế blacklist logout hiện có — CLAUDE.md §9.1); phát cặp token MỚI với `jti` mới, blacklist `jti` cũ (rotation, chống replay). Không bảng session (cấm dùng `user_sessions`).
- **PA-2 (có lưu vết):** như PA-1 nhưng thêm lưu `hashRefreshToken(token)` vào Redis TTL khi login/refresh, và refresh chỉ hợp lệ khi hash khớp bản đang lưu → revoke được từng thiết bị. Tận dụng hàm `token.service.ts:34` đang bỏ không.

**DTO/response gợi ý:** `RefreshTokenDto { refreshToken: string }` (class-validator `@IsString() @IsNotEmpty()`); response `{ success, message, data: { accessToken, refreshToken, expiresIn } }` — khớp đúng shape FE đọc ở `request.js:108`.
**Permission:** public endpoint (không JWT — token đã hết hạn mới gọi được). **Ước lượng:** vừa.

### BE-02 🚧 Thêm `GET /meetings` (list, admin) — chặn 2 màn Business Admin

**Bằng chứng FE:** `businessAdminServices.js:229` `get(/meetings${query})`; màn `bussinessAdmin/MeetingManagement.jsx:63`, `bussinessAdmin/RecordingManagement.jsx:65`.
**Hiện trạng BE:** `meetings.controller.ts` có `GET meetings/:meetingId` (`:230`) nhưng **không có** GET list. URL `/meetings` (1 segment) không khớp route nào → 404.
**Đề xuất:** `GET /meetings` trong `meetings.controller.ts` (khai **trước** `GET meetings/:meetingId` cùng số segment không sao, nhưng giữ thói quen static-trước-động). Query DTO theo chuẩn §8.4 CLAUDE.md: `page, limit(max 100), sortBy(allowlist), sortOrder` + filter `status, roomId, organizerId, from, to, search(title)`. Response list + `meta` pagination.
**Permission gợi ý:** `meeting.read.all` (mới — seed migration; phân biệt với `schedule.read.self` của `GET /me/schedule` `meetings.controller.ts:735`). **Ước lượng:** vừa.

### BE-03 🚧 `PATCH /meetings/:id` (update chung) — chặn màn sửa meeting

**Bằng chứng FE:** payload FE đang gửi khi "sửa cuộc họp":
- `manager/MeetingDetail.jsx:264-272`: `{ title, roomId, scheduledStart, scheduledEnd, participantIds, recordingEnabled, agenda }` → `managerServices.js:187` `patch(/meetings/${id})`. Bản employee tương tự `employee/MeetingDetail.jsx:272,342`.
- `bussinessAdmin/MeetingManagement.jsx:135-148`: `{ title, roomId, startTime, endTime, description, organizer }` → `businessAdminServices.js:237`.

**Hiện trạng BE:** chỉ có `PATCH meetings/:meetingId/time` (`meetings.controller.ts:173`, perm `meeting.time.update`) và `PATCH meetings/:meetingId/room` (`:426`, perm `meeting.room.update`). `PATCH /meetings/:id` 2-segment → 404.
**Đề xuất:** KHÔNG gộp tất cả vào một PATCH to (participants/agenda/recording đã có endpoint chuyên trách: participants `:290/:848`, agendas `:959` — sau BE-06, recording-config `recording-config.controller.ts:29-74`). Chỉ thêm **`PATCH /meetings/:meetingId` cho metadata**: `title`, `description` (DTO `UpdateMeetingDto`, cả 2 optional, validate độ dài). Time/room FE tách call sang endpoint sẵn có (đã ghi ở plan Nam P0-6).
**Permission gợi ý:** `meeting.update.own` (kiểm quyền sở hữu như `meeting.cancel.own` `:480`). **Ước lượng:** nhỏ-vừa.

### BE-04 🚧 `GET /users/export` — path tĩnh bị route param nuốt

**Bằng chứng FE:** `sysAdminServices.js:328`, `businessAdminServices.js:132`; màn `bussinessAdmin/UserManagement.jsx` (nút Export).
**Hiện trạng BE:** `users.controller.ts` khai `@Get('import/template')` `:126`, `@Get()` `:649`, `@Get('manage')` `:693`, `@Get(':userId')` `:746` — **không có** `export`. `GET /users/export` khớp `@Get(':userId')` với `userId="export"` → lỗi validate/404 khó hiểu thay vì 404 sạch, và đòi perm `account.user.read.detail` (`:748`).
**Đề xuất:** thêm `@Get('export')` **khai TRƯỚC `@Get(':userId')`** (Nest match theo thứ tự khai báo trong controller). Vì export có thể >2s (ARCH-02) → theo mapping CLAUDE.md §5.3: chạy qua `background_jobs` + output vào `media_files`, trả `{ jobId }` để FE poll `GET /background-jobs/:id` (đã có, `background-jobs.controller.ts:41`); hoặc trả file trực tiếp nếu dataset nhỏ — Tài quyết theo số liệu thật.
**Permission gợi ý:** `accounts.user.export` (seed migration). **Ước lượng:** vừa.

### BE-05 Hai `GET` trùng đường `meetings/:meetingId/attendance`

Có **HAI** route trùng, **cùng** method `GET`:
- `live-meeting.controller.ts:458` — `@Get('meetings/:meetingId/attendance')`
- `attendance.controller.ts:36` — `@Controller('meetings/:meetingId/attendance')` (`:31`) + `@Get()`

⚠ `manual-attendance.controller.ts` (`:59` POST, `:96`/`:131` PATCH, `:168` POST) là **method KHÁC — KHÔNG trùng, KHÔNG được đụng.** Đây là module điểm danh thủ công đang chạy đúng.

Route nào trong hai `GET` thắng hiện phụ thuộc **thứ tự import trong `app.module.ts`** (hiện `AttendanceModule` — `app.module.ts:104` — đứng trước `LiveMeetingModule` — `:107` → handler `attendance.controller.ts:36` đang thắng) — bom nổ chậm: đổi thứ tự import là đổi hành vi mà không ai biết.

Việc cần làm, theo thứ tự:
1. Đọc handler cả hai `GET` — trả **cùng** dữ liệu hay **khác**?
2. **Cùng** → xoá một, giữ cái thuộc module đúng nghiệp vụ (khuyến nghị `attendance.controller` — đúng module boundary CLAUDE.md §11.8).
3. **Khác** (vd một cho meeting đang diễn ra, một cho lịch sử) → **đổi path** một cái, **KHÔNG xoá** — cả hai đang phục vụ mục đích riêng.
4. Gỡ dứt điểm để route không còn phụ thuộc thứ tự import.

**Ước lượng:** nhỏ (nếu cùng dữ liệu) / vừa (nếu phải đổi path + cập nhật FE gọi tương ứng).

### BE-06 🚧 5 route thiếu prefix `meetings/` trong `meetings.controller.ts` — chặn luồng agenda của BookMeeting

**Bằng chứng:** controller khai `@Controller()` rỗng (`meetings.controller.ts:114`), các route sau vì thế nằm ở **root** thay vì dưới `/meetings`:
- `@Delete(':meetingId/participants/:participantUserId')` `:795`
- `@Get(':meetingId/agendas')` `:924`
- `@Put(':meetingId/agendas')` `:959`
- `@Patch(':meetingId/agendas/:agendaId')` `:1030`
- `@Delete(':meetingId/agendas/:agendaId')` `:1109`

Path thật đang chạy: `/api/v1/:meetingId/agendas`… FE gọi đúng chuẩn `/api/v1/meetings/:id/agendas` (`employeeServices.js:58`, màn `employee/BookMeeting.jsx:578`) → **404, agenda không lưu được khi đặt họp**.
**Đề xuất:** thêm tiền tố `meetings/` vào 5 decorator (sửa 5 dòng). Vi phạm convention §7.3 CLAUDE.md hiện tại là ở phía BE. Kiểm tra: không consumer nào khác đang gọi path cũ không-prefix (FE không có — đã đối chiếu bản đồ; Python service/IVSS không gọi nhóm này — CẦN XÁC MINH nhanh với Hải).
**Permission:** giữ nguyên (JWT). **Ước lượng:** nhỏ. **Đây là mục rẻ nhất mà mở khoá được luồng đặt họp có agenda.**

---

## A.2 🔴 NGHIỆP VỤ — `zone-presence-timeline` sai với mô hình dữ liệu MỚI (chỉ-`appear`)

**Bối cảnh đã chốt bởi chủ dự án:** luồng nhận diện mặt ghi `zone_presence_events` theo mô hình **nhật ký bắt gặp (sighting log)** — camera thấy người X ở zone Y lúc T → ghi 1 dòng `event_type='appear'`. **Không bao giờ có `disappear`** từ luồng này (camera bắn khi *thấy* mặt, không bắn khi người rời khung).

**Hiện trạng code (của Tài — xác minh 2026-07-26):** `src/modules/campus-dashboard/services/zone-presence-timeline.service.ts`
- `getTimeline()` khi có `userId` gọi `pairEnterExit()` và trả `totalDurationSeconds`, `ongoing` (`:80-88`).
- `pairEnterExit()` `:103-118` ghép cặp: `appear` → set `pendingEnter` (`:108-109`); `disappear` + có `pendingEnter` → cộng thời lượng (`:110-114`); trả `{ totalDurationSeconds, ongoing: pendingEnter !== null }` (`:117`).
- Serve qua `GET /campus-dashboard/zones/:zoneId/timeline` (`zone-presence-timeline.controller.ts:28`, perm `campus_dashboard.timeline.read`). Ghi chú: code comment đánh nhãn **ZPT-001/UC-119** (`app.module.ts:121`, docblock `:25`).

**Hệ quả với mô hình chỉ-`appear`:** nhánh `disappear` (`:110`) không bao giờ chạy → `totalDurationSeconds` luôn **0**, `ongoing` luôn **true** ngay khi có 1 lần bắt gặp; các `appear` sau chỉ ghi đè `pendingEnter` (`:109`). Màn timeline sẽ hiển thị "đang ở trong zone từ lần thấy cuối, tổng thời gian 0s" — sai nghiệp vụ.

**Hai hướng sửa (đề xuất — quyết định thuộc về Tài):**
- **(a) — KHUYẾN NGHỊ: đổi timeline thành danh sách dấu vết bắt gặp.** Mỗi `appear` là một điểm sự kiện ("09:12 — thấy tại Hành lang A"). Bỏ `pairEnterExit`, bỏ `totalDurationSeconds`/`ongoing` khỏi `ZoneTimelineResponseDto` (`src/modules/campus-dashboard/dto/zone-timeline-response.dto.ts`) hoặc để `null` + field mới `sightingCount`. Trung thực với dữ liệu, không suy diễn. FE **chưa xây** màn timeline (bản đồ Nhóm 3 — 0 lời gọi) → đổi response shape lúc này là **rẻ nhất, không breaking ai**.
- **(b) — KHÔNG khuyến nghị: giữ phiên, suy `disappear` bằng cron timeout.** Rủi ro: **bịa sự kiện** người chưa chắc đã rời (đi khuất góc camera ≠ rời zone); nếu persist event suy diễn là vi phạm tính chất append-only log thật của `zone_presence_events` (CLAUDE.md §5.5 quy tắc 3); nếu chỉ suy trong RAM thì số liệu thời lượng vẫn là đoán, kèm cron + config timeout phát sinh phức tạp không có nguồn dữ liệu chống lưng.

**Không bị ảnh hưởng (đã xác minh):** `RestrictedZoneIntrusionService` (`src/modules/restricted-zone/services/restricted-zone-intrusion.service.ts`) chỉ tiêu thụ sự kiện có `userId` và xét khung giờ/allowlist (`:98`, `:139-162` — `isViolation`), **không dùng `disappear`** → giữ nguyên.
**Ảnh hưởng lân cận cần Tài liếc qua:** heatmap `zone-traffic-heatmap` và `campus-dashboard/overview` nếu có chỗ nào giả định tồn tại `disappear` — CẦN XÁC MINH (chưa đọc 2 service này ở mức dòng).

**Ước lượng:** vừa (hướng a). **Không chặn Nam ngay** nhưng phải chốt **trước khi** Nam xây màn Campus Dashboard (P2 của Nam) — nếu không Nam xây theo shape cũ rồi đập lại.

---

## A.3 🟠 NỢ — route FE cần nhưng BE chưa có (Nhóm 2 loại-b còn lại)

### BE-07 🚧 Notifications: đánh dấu đã đọc
- **FE gọi:** `PATCH /notifications/:id/read` (`sysAdminServices.js:366`, `businessAdminServices.js:302`) + `PATCH /notifications/read-all` (`sysAdminServices.js:375`, `businessAdminServices.js:311`); màn `systemAdmin/Notifications.jsx`.
- **BE:** `notifications.controller.ts` chỉ có `GET notifications` `:137`, `GET notifications/:id` `:154`.
- **Đề xuất:** `PATCH /notifications/:id/read` + `PATCH /notifications/read-all` (chỉ tác động record của user hiện tại — lấy từ token, không tin body). Idempotent tự nhiên (set read_at nếu null). Permission: `notification.update.self` (mới, seed migration) hoặc tái dùng `notification.read.self` — Tài chọn. **Ước lượng:** nhỏ.

### BE-08 🚧 `PATCH /departments/:id`
- **FE gọi:** `sysAdminServices.js:285`, `businessAdminServices.js:149`; màn `bussinessAdmin/DepartmentManagement.jsx:277`.
- **BE:** `departments.controller.ts` chỉ có `POST` `:43` (perm `department.create`), `GET` `:105` (perm `department.read`).
- **Đề xuất:** `PATCH /departments/:id`, DTO `UpdateDepartmentDto { name?, description?, ... }` (đối chiếu entity `departments`), perm `department.update` (seed migration). **Ước lượng:** nhỏ.

### BE-09 🚧 System configurations (GET + PATCH)
- **FE gọi:** `GET /system-configurations` (`sysAdminServices.js:241`), `PATCH /system-configurations` body `{ key, value }` (`:252`); màn `systemAdmin/SystemSettings.jsx:47,177,205`.
- **BE:** module administration **không có** controller system-config (chỉ `audit-logs.controller.ts`, `background-jobs.controller.ts`). Bảng `system_configs` có trong baseline 39 bảng (CLAUDE.md §5.2).
- **Đề xuất:** controller mới trong `administration`: `GET /system-configurations` (list key/value) + `PATCH /system-configurations` (upsert theo `key` — hoặc RESTful hơn: `PATCH /system-configurations/:key`; nếu đổi path thì báo Nam sửa 1 dòng service). Perm `admin.manage_config` (đúng ví dụ naming CLAUDE.md §9.2). Cẩn trọng: đây là chỗ chứa feature flags (§4.2) — validate `key` theo allowlist, không cho ghi key tuỳ ý. **Ước lượng:** vừa.

### BE-10 `PATCH /face-access/stranger-alerts/:id/resolve`
- **FE gọi:** `businessAdminServices.js:208` — hàm `resolveStrangerAlert` hiện **chưa màn nào nối** (không import ngoài service) → chưa nổ 404, ưu tiên thấp.
- **BE:** `stranger-alert.controller.ts` chỉ có `GET` `:23` (perm `face.stranger.read`).
- **Đề xuất:** `PATCH /face-access/stranger-alerts/:id/resolve`, DTO `{ note? }`, ghi `resolved_by/resolved_at`, perm `face.stranger.resolve` (seed). **Ước lượng:** nhỏ.

### BE-11 `POST /meetings/:id/check-in` (self check-in) — cần QUYẾT ĐỊNH nghiệp vụ trước
- **FE gọi:** `managerServices.js:201`, `employeeServices.js:147` — hàm `checkInMeeting` **chưa màn nào nối**.
- **BE:** không có route; check-in hiện đi qua Face Terminal (device callback) hoặc điểm danh thủ công của host (`manual-attendance.controller.ts:59`, perm `attendance.manual.create`).
- **Đề xuất:** đưa ra team quyết: (i) nếu self check-in KHÔNG thuộc scope (check-in bằng mặt tại cửa) → Nam xoá 2 hàm FE, đóng mục; (ii) nếu thuộc scope → BE thêm `POST /meetings/:id/check-in` lấy user từ token, validate là participant + trong khung giờ. **KHÔNG làm trước khi chốt.** **Ước lượng:** nhỏ-vừa (nếu làm).

---

## A.4 CHECKLIST CHO TÀI

| ✔ | ID | Việc | Ưu tiên | Ước lượng | 🚧 Chặn Nam? |
|---|---|---|---|---|---|
| ☐ | BE-01 | `POST /auth/refresh` (PA-1/PA-2) | **P0 — số 1** | Vừa | 🚧 MỌI màn hình |
| ☐ | BE-06 | Thêm prefix `meetings/` cho 5 route (5 dòng decorator) | P0 | Nhỏ | 🚧 BookMeeting (agenda), quản lý participant |
| ☐ | BE-02 | `GET /meetings` list + query DTO | P0 | Vừa | 🚧 MeetingManagement, RecordingManagement |
| ☐ | BE-03 | `PATCH /meetings/:id` (title/description) | P0 | Nhỏ-vừa | 🚧 MeetingDetail (manager/employee), MeetingManagement |
| ☐ | BE-07 | Notifications mark-read + read-all | P1 | Nhỏ | 🚧 Notifications (systemAdmin) |
| ☐ | BE-08 | `PATCH /departments/:id` | P1 | Nhỏ | 🚧 DepartmentManagement |
| ☐ | BE-09 | System-configurations GET+PATCH | P1 | Vừa | 🚧 SystemSettings |
| ☐ | BE-04 | `GET /users/export` (job/file) | P1 | Vừa | 🚧 UserManagement (nút export) |
| ☐ | BE-05 | Gỡ trùng HAI `GET meetings/:meetingId/attendance` (manual-attendance KHÔNG đụng) | P1 | Nhỏ/Vừa | Không (route đang chạy đúng qua attendance.controller) |
| ☐ | A.2 | Timeline sighting-log — chốt hướng (a)/(b) | P1 | Vừa | Chặn màn Campus Dashboard của Nam (P2) |
| ☐ | BE-10 | Stranger-alert resolve | P2 | Nhỏ | Không (FE chưa nối màn) |
| ☐ | BE-11 | Self check-in — chốt scope với team trước | P2 | Nhỏ-vừa | Không (FE chưa nối màn) |

**Nhắc lại 2 quy tắc dễ quên:** (1) mỗi endpoint mới = 1 migration seed permission cùng commit (không thì 403 — CLAUDE.md §5.5 q.4); (2) route path tĩnh khai TRƯỚC route `:param` cùng cấp trong cùng controller.
