# Data Model: Guest External Live Meeting Access (GLA-001)

**Phase 1 output**

---

## 1. Entities (không thêm bảng — chỉ đọc/ghi các bảng đã tồn tại)

### `meeting_external_participants` (ghi `metadata_json`, đọc các cột khác)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | UUID | Phần đầu của link mời — khóa tra cứu chính |
| `meeting_id` | UUID | Xác định cuộc họp |
| `full_name` | varchar | Hiển thị trong phòng chờ cho host, và trong `metadata_json` của `attendance_events`/`audit_logs` |
| `email` | varchar (nullable) | Đích gửi OTP/link — nếu NULL thì không sinh được lời mời (FR-GLA-004) |
| `organization_name` | varchar (nullable) | Hiển thị "tên + tổ chức" theo Mức B |
| `invitation_status` | varchar | KHÔNG bị feature này thay đổi (giữ nguyên ý nghĩa "đã nhận lời mời họp" hiện có) |
| `metadata_json` | jsonb (nullable) | **Ghi mới nhánh `guestInvite`** — xem mục 2 |

### `meetings` (chỉ đọc)

| Field | Type | Vai trò |
|---|---|---|
| `id`, `status` (enum `MeetingStatus`), `start_time`, `end_time`, `host_id` | — | Tính cửa sổ thời gian (FR-GLA-017), kiểm tra `cancelled`/`completed` (FR-GLA-015/032), ownership check phía host (FR-GLA-024) |

### `attendance_events` (ghi mới, không sửa dòng nhân viên hiện có)

| Field | Giá trị cho guest event |
|---|---|
| `meeting_id` | UUID cuộc họp |
| `attendance_record_id` | `NULL` |
| `user_id` | `NULL` (bắt buộc — khách không có `users.id`) |
| `room_id` | `NULL` hoặc `meeting.roomId` nếu có sẵn, không bắt buộc |
| `device_id` | `NULL` |
| `event_type` | `'guest_join'` \| `'guest_leave'` — **KHÔNG dùng `'check_in'`/`'check_out'`** (FR-GLA-040) |
| `event_time` | `now()` |
| `source_type` | `'guest_portal'` |
| `metadata_json` | `{ externalParticipantId, fullName, organizationName }` |

### `audit_logs` (ghi mới cho từng sự kiện)

| Trường hợp | `user_id` | `action_type` (đề xuất) |
|---|---|---|
| Sinh lời mời (booking approved) | `<approver.userId>` | `guest_invite_issued` — có actor rõ ràng (người approve), khác các dòng khác trong bảng này vốn không có `users.id` nào để gán |
| Gửi lại link (host) | `<host.userId>` | `guest_invite_resent` |
| Thu hồi quyền truy cập (host) | `<host.userId>` | `guest_access_revoked` |
| Thu hồi tự động do meeting cancelled/completed | `NULL` | `guest_access_auto_revoked` |
| Gửi OTP | `NULL` | `guest_otp_requested` |
| Xác minh OTP thành công | `NULL` | `guest_otp_verified` |
| Xác minh OTP thất bại | `NULL` | `guest_otp_verify_failed` |
| Host duyệt phòng chờ | `<host.userId>` | `guest_admitted` |
| Host từ chối phòng chờ | `<host.userId>` | `guest_rejected` |

Với `user_id = NULL` (hành vi của khách), `metadata_json` **BẮT BUỘC** chứa `{ externalParticipantId, meetingId, ipAddress?, userAgent? }` để vẫn truy vết được ai/việc gì, bù cho việc không gán được `user_id`.

### `system_configs` (chỉ đọc trong v1, ghi qua API sẵn có của `administration` nếu Admin cần đổi)

| `config_key` | Giá trị mặc định | Ý nghĩa |
|---|---|---|
| `guest_access.verification_mode` | `"otp"` | `otp` \| `magic_click` (chỉ `otp` được implement — FR-GLA-025) |
| `guest_access.lobby_enabled` | `"true"` | Bật/tắt phòng chờ toàn hệ thống (mặc định) |
| `guest_access.join_window_before_minutes` | `"30"` | Cửa sổ cho phép vào TRƯỚC `startTime` |
| `guest_access.join_window_after_minutes` | `"15"` | Cửa sổ cho phép vào SAU `endTime` |

> Lưu ý: `system_configs.config_key` không có unique constraint thật trên RDS (xem memory dự án) — đọc phải `ORDER BY` + lấy dòng gần nhất, mirror cách các module khác đã xử lý vấn đề này.

Override cấp-cuộc-họp cho `lobby_enabled` (FR-GLA-027): lưu trong `meetings.metadata_json` nếu cột đó tồn tại, HOẶC (nếu không) lưu trong chính `meeting_external_participants.metadata_json` ở một khóa riêng cấp-meeting là không hợp lý (khóa đó thuộc về participant, không thuộc meeting) — **cần xác nhận trong `plan.md`** cột `metadata_json` có tồn tại trên `meetings` hay không trước khi implement; nếu không tồn tại, phương án dự phòng là dùng `system_configs` với `config_key = "guest_access.lobby_enabled:<meetingId>"` (per-meeting override key, đọc ưu tiên override trước default).

---

## 2. Hình dạng `guestInvite` trong `metadata_json`

```jsonc
// meeting_external_participants.metadata_json
{
  // ... các key khác đã tồn tại từ trước (nếu có) — KHÔNG được xóa mất
  "guestInvite": {
    "tokenHash": "9f2c...e41a",        // SHA-256(secret), hex, 64 ký tự
    "issuedAt": "2026-08-07T09:00:00Z",
    "issuedBy": "<user_id của host thực hiện approve/resend>",
    "expiresAt": "2026-08-09T11:00:00Z",  // = meeting.endTime + 24h tại thời điểm sinh
    "status": "active",                // active | used | revoked
    "invalidAfter": null,              // ISO datetime | null — set khi host revoke hoặc meeting cancelled/completed
    "firstJoinedAt": null,
    "lastJoinedAt": null
  }
}
```

### Quy tắc ghi (bắt buộc `jsonb_set`, không đọc-sửa-ghi JS)

```sql
UPDATE meeting_external_participants
SET metadata_json = jsonb_set(
      COALESCE(metadata_json, '{}'::jsonb),
      '{guestInvite}',
      $1::jsonb,
      true
    )
WHERE id = $2
```

Toàn bộ object `guestInvite` được ghi đè nguyên khối mỗi lần cập nhật (không patch từng field con) — vì service luôn đọc lại toàn bộ `guestInvite` hiện có, sửa field cần thiết trong bộ nhớ, rồi ghi lại nguyên khối trong CÙNG 1 câu `UPDATE` (không có khoảng hở giữa đọc và ghi cho phép request khác chen vào — nếu cần tuyệt đối an toàn với concurrent write, cân nhắc `SELECT ... FOR UPDATE` trong transaction ngắn thay vì đọc rồi ghi 2 câu lệnh riêng biệt).

### Quy tắc đọc

```sql
SELECT metadata_json -> 'guestInvite' AS guest_invite
FROM meeting_external_participants
WHERE id = $1
```

Không kéo `metadata_json` đầy đủ về rồi `JSON.parse` thủ công trong TypeORM khi chỉ cần nhánh `guestInvite`.

---

## 3. Redis Key Schema

| Key | Kiểu | Nội dung | TTL |
|---|---|---|---|
| `guest:otp:<inviteId>` | string | Hash SHA-256 của OTP hiện tại | 10 phút |
| `guest:otp_attempt:<inviteId>` | string (counter) | Số lần nhập sai liên tiếp, dùng `INCR` | 15 phút (reset khi OTP mới được sinh) |
| `guest:otp_send:<inviteId>` | string (counter) | Số lần đã gửi OTP trong cửa sổ hiện tại, dùng `INCR` | 5 phút |
| `guest:otp_blocked:<inviteId>` | string (`"1"`) | Cờ khóa tạm sau khi nhập sai quá 5 lần | 15 phút |
| `guest:session:<jti>` | string/JSON | Metadata phiên đang hoạt động (deviceId, issuedAt) | = TTL phiên (tối đa 4h) |
| `guest:revoked:<jti>` | string (`"1"`) | Đánh dấu 1 phiên cụ thể đã bị thu hồi (ví dụ: host từ chối ở lobby) | = TTL còn lại của phiên đó |
| `guest:invite:<inviteId>:invalid_after` | string (timestamp ms) | Mốc vô hiệu hóa MỌI phiên của 1 lời mời — mirror `auth:user:<id>:invalid_after` | 24h (đủ dài hơn TTL phiên tối đa) |
| `guest:lobby:<meetingId>` | SET | Danh sách `inviteId` đang chờ duyệt | Không TTL cố định — dọn khi meeting cancelled/completed hoặc khi rời hàng chờ |
| `guest:lobby:status:<inviteId>` | string (`waiting`\|`admitted`\|`rejected`) | Trạng thái phòng chờ hiện tại của 1 lời mời | Theo vòng đời phiên |
| `guest:device:<inviteId>:<deviceId>` | string (`"1"`) | Ghi nhớ thiết bị đã qua OTP | 30 ngày |

`inviteId` = `meeting_external_participants.id` (cùng giá trị dùng trong link mời) — dùng xuyên suốt làm khóa tương quan giữa Postgres và Redis, tránh cần thêm 1 ID riêng nào khác.

---

## 4. Guest JWT Payload

```jsonc
{
  "typ": "guest",
  "sub": "<external_participant_id>",
  "mid": "<meeting_id>",
  "scope": ["meeting.guest.view"],
  "jti": "<uuid v4>",
  "iat": 1234567890,
  "exp": 1234567890   // = iat + 4h (chặn trên tuyệt đối — xem research.md rủi ro #6)
}
```

Ký bằng `GUEST_TOKEN_SECRET` (env, bắt buộc, tối thiểu 16 ký tự, KHÁC `AUTH_ACCESS_TOKEN_SECRET`).

**Kiểm tra bổ sung ở mỗi request** (ngoài verify JWT chuẩn): đọc tươi `meetings.endTime`/`status` từ DB, so `now <= endTime + join_window_after_minutes` VÀ `status NOT IN (cancelled, completed)` VÀ `guest:invite:<sub>:invalid_after` chưa vượt qua VÀ `guest:revoked:<jti>` không tồn tại. JWT hợp lệ về chữ ký/`exp` là điều kiện CẦN, không phải ĐỦ.

---

## 5. Data Lifecycle (tổng quan)

```
Booking approved (có khách, có email)
  → guestInvite.status = 'active', gửi email link
  → [Khách bấm link] GET /guest/invites/:token → (không đổi state)
  → [Khách xin OTP] POST .../otp → guest:otp:<id> (Redis)
  → [Khách verify] POST .../verify
      → guestInvite.status = 'used', firstJoinedAt/lastJoinedAt set
      → cấp guest JWT (jti mới)
      → [nếu lobby bật] guest:lobby:<meetingId> += inviteId, status='waiting'
  → [Host admit] → status='admitted' (Redis) → khách đọc được nội dung
  → [Host reject | revoke] → guest:revoked:<jti> HOẶC invite.invalidAfter=now()
  → [Meeting cancelled/completed] → invite.invalidAfter=now() cho MỌI invite của meeting đó
  → [Host "Gửi lại link"] → guestInvite bị ghi đè (tokenHash/expiresAt mới), status quay về 'active'
```
