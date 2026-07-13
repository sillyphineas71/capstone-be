# Quickstart: AI Draft Feature Availability (MKM-AI-03)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo quickstart: cách verify endpoint feature-flag | Toàn bộ file |

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Tasks**: [tasks.md](./tasks.md)

## 1. Đọc trạng thái feature flag theo meeting

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/meetings/$MEETING_ID/minutes/ai-draft-config | jq '.data'
```

Kỳ vọng: `{ "enabled": true|false, "requireHumanReview": true|false }`. Luôn **200** — `enabled=false` là trạng thái hợp lệ, không phải lỗi.

## 2. Bật/tắt flag để kiểm tra (System Admin, qua system_configs hiện có)

```sql
UPDATE system_configs
SET config_json = jsonb_set(config_json, '{enabled}', 'false')
WHERE config_key = 'ai.minutes_summary';
```

Gọi lại endpoint 1 → `enabled` phải đổi theo ngay (không cache).

## 3. Fail-safe khi thiếu config

```sql
UPDATE system_configs SET is_active = false WHERE config_key = 'ai.minutes_summary';
```

Gọi lại endpoint 1 → kỳ vọng `{ "enabled": false, "requireHumanReview": true }` (không lỗi 500).

## 4. Kiểm tra ownership

- Token của Host meeting → 200.
- Token của Admin (không phải Host) → 200.
- Token của user khác (participant thường) → 403 `PERMISSION_DENIED`.
- `meetingId` không tồn tại → 404 `MEETING_NOT_FOUND`.

## 5. Chạy test

```bash
npx jest src/modules/minutes
npx tsc --noEmit -p tsconfig.build.json
```
