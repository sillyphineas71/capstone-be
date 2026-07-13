# Quickstart: AI Meeting Minutes Draft (MKM-AI-01)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-07 | Khởi tạo quickstart cho feat-ai-meeting-minutes-draft (Phase 4/T019): hướng dẫn migration, seed, env, bật flag, curl demo, chạy Ollama thật, troubleshooting | Toàn bộ file |

> Hướng dẫn chạy demo tính năng AI tạo biên bản họp nháp end-to-end. Có 2 chế độ:
> **mock** (mặc định, không cần Ollama/GPU) và **self_hosted_llm** (Ollama + Qwen2.5 thật).

## 0. Yêu cầu hạ tầng
- PostgreSQL (đã chạy, có schema baseline v3.2 Compact).
- Redis (cho BullMQ) — `docker compose -f docker-compose.dev.yml up -d redis`.
- Node backend build được: `npm run build`.
- (Tùy chọn, chỉ khi dùng LLM thật) Ollama đã cài + đã pull model.

## 1. Chạy migration thêm cột `ai_summary_json`
Cột `meeting_minutes.ai_summary_json` (jsonb, nullable) là thay đổi schema duy nhất.

```bash
# Nếu ledger migration của repo đang sạch:
npm run migration:run:tsx
```

Nếu migration runner bị chặn bởi migration cũ lỗi (đã biết: `iot_devices` 42P07), áp cột trực tiếp — migration viết `IF NOT EXISTS` nên an toàn:

```sql
ALTER TABLE meeting_minutes ADD COLUMN IF NOT EXISTS ai_summary_json jsonb NULL;
```

## 2. Chạy 2 seed (thủ công, bắt buộc trước khi test)
Seed không tự chạy (pattern chung của repo). Cả 2 seed đã đăng ký trong `scripts/run-seeds.ts` — chạy toàn bộ:

```bash
npx tsx scripts/run-seeds.ts
```

Kết quả cần có:
- Permission `meeting.minutes.ai_draft.create` gán cho `EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN`.
- `system_configs` key `ai.minutes_summary` với `enabled=false`, `provider=mock` (fail-safe).

## 3. Cấu hình env (đã có default trong `.env.example`)
```env
QUEUE_MINUTES_AI_DRAFT=minutes.generate_ai_draft
AI_SUMMARY_LLM_BASE_URL=http://localhost:11434
AI_SUMMARY_LLM_TIMEOUT_MS=300000
```

## 4. Bật feature flag (mặc định TẮT)
Feature flag mặc định `false` để an toàn. Bật khi demo (chỉ SYSTEM_ADMIN qua system-configs, hoặc SQL trực tiếp cho dev):

```sql
-- Chế độ MOCK (không cần Ollama):
UPDATE system_configs
SET config_json = config_json || '{"enabled": true, "provider": "mock"}'::jsonb
WHERE config_key = 'ai.minutes_summary';
```

## 5. Chuẩn bị dữ liệu test
1. 1 user có permission `meeting.minutes.ai_draft.create` + đã login lấy JWT.
2. 1 `meeting` với `host_id` = user đó (hoặc dùng SYSTEM_ADMIN cho meeting bất kỳ).
3. 1 `transcript` thuộc meeting đó, `status IN (draft, reviewed, approved)`, `security_status NOT IN (restricted, blocked)`.
4. Meeting **chưa có** `meeting_minutes` active (nếu có, dùng `forceRerun=true` và bản đó phải là AI-draft).

## 6. Demo Happy Path
```bash
# B1: tạo job
curl -X POST http://localhost:3000/api/v1/meetings/<meetingId>/minutes/ai-draft-jobs \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"transcriptId": "<transcriptId>"}'
# Kỳ vọng: 202 { success, data: { jobId, meetingId, status: "queued" } }

# B2: poll trạng thái job (dùng jobId ở trên)
curl http://localhost:3000/api/v1/background-jobs/<jobId> \
  -H "Authorization: Bearer <jwt>"
# Khi xong: status="completed", result={ minutesId, meetingId, status: "draft" }

# B3: xem biên bản nháp AI đã tạo
curl http://localhost:3000/api/v1/meetings/<meetingId>/minutes \
  -H "Authorization: Bearer <jwt>"
# minutes_content = summary; decisions_json/action_items_json/ai_summary_json đúng schema
```

## 7. (Tùy chọn) Chạy với Ollama + Qwen2.5 thật
```bash
# B1: cài Ollama (Windows)
winget install --id Ollama.Ollama

# B2: pull model — máy yếu (< 4GB free RAM) dùng 3b, máy khỏe dùng 7b
ollama pull qwen2.5:3b-instruct   # ~1.9GB, chạy được trên 16GB RAM
# hoặc: ollama pull qwen2.5:7b-instruct

# B3: đảm bảo Ollama server chạy (http://localhost:11434)

# B4: đổi config sang LLM thật
```
```sql
UPDATE system_configs
SET config_json = config_json || '{"enabled": true, "provider": "self_hosted_llm", "modelName": "qwen2.5:3b-instruct"}'::jsonb
WHERE config_key = 'ai.minutes_summary';
```
> Benchmark thực tế (máy 16GB RAM, CPU-only, xem plan.md mục 14): inference warm ~32s, cold ~104s. Timeout 5 phút đủ headroom.

## 8. Test các kịch bản lỗi
| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Thiếu token | Không gửi header Authorization | `401` |
| Không có permission | User thiếu `meeting.minutes.ai_draft.create` | `403` |
| Không phải Host/SysAdmin | JWT user khác không phải host | `403 PERMISSION_DENIED` |
| Flag tắt | `enabled=false` | `403 AI_SUMMARY_DISABLED` |
| Transcript chưa xong | transcript `status=processing` | `422 TRANSCRIPT_NOT_READY` |
| Transcript hạn chế | `security_status=restricted` | `403 TRANSCRIPT_RESTRICTED` |
| Đã có minutes | Gọi lần 2, `forceRerun=false` | `409 MINUTES_ALREADY_EXISTS` |
| Job đang chạy | Gọi 2 lần liên tiếp khi job 1 chưa xong | `409 AI_JOB_ALREADY_RUNNING` |
| `transcriptId` sai định dạng | UUID không hợp lệ | `400` |

## 9. Lỗi trong worker (phản ánh qua background_jobs.error_message)
| Error code | Nguyên nhân |
| :--- | :--- |
| `LLM_UNAVAILABLE` | Ollama không chạy/timeout — job retry 1 lần rồi failed |
| `AI_OUTPUT_INVALID_SCHEMA` | Model trả JSON sai schema sau 1 lần repair (model yếu) |
| `TRANSCRIPT_TOO_LONG_FOR_MVP` | Transcript vượt `maxInputTokens` (mặc định 6000) |

## 10. Tắt lại flag sau khi demo (khuyến nghị)
```sql
UPDATE system_configs
SET config_json = config_json || '{"enabled": false, "provider": "mock"}'::jsonb
WHERE config_key = 'ai.minutes_summary';
```

## 11. Chạy integration test (tùy hạ tầng live)
```bash
# Cần Postgres + Redis đang chạy
RUN_INTEGRATION=1 npx jest --config ./test/jest-e2e.json ai-minutes-draft-lifecycle
```
Mặc định SKIP nếu không set `RUN_INTEGRATION=1` (để `npm test` không vỡ khi thiếu hạ tầng).
