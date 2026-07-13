# Quickstart: AI Minutes Review Integration (MKM-AI-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo quickstart: cách verify expose detail, sửa tay round-trip, badge list, endpoint list AI job | Toàn bộ file |
| 2026-07-13 | Sửa mục 4: response job dùng `scheduledAt/startedAt/completedAt` (không có `createdAt`) | Mục 4 |

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Tasks**: [tasks.md](./tasks.md)

> Tiền đề: đã có 1 nháp AI (chạy MKM-AI-01, xem quickstart của feature đó) và JWT của Host. Đặt `TOKEN`, `MINUTES_ID`, `MEETING_ID` theo môi trường.

## 1. Đọc chi tiết — kiểm tra expose AI (R2)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/meeting-minutes/$MINUTES_ID | jq '.data | {isAiGenerated, aiSummary, decisions: .mainContent.decisions, actionItems: .mainContent.actionItems}'
```

Kỳ vọng: `isAiGenerated=true`; `aiSummary` có `keyPoints/risks/openQuestions/uncertainParts/meta`; `decisions[i]` có `text/confidence/evidence`; `actionItems[i]` có `task/owner/deadline/confidence`. Với biên bản soạn tay: `isAiGenerated=false`, `aiSummary=null`.

## 2. Sửa tay trọn vẹn kết quả AI (R3)

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3000/api/v1/meeting-minutes/$MINUTES_ID \
  -d '{
    "versionNo": 1,
    "decisionsJson": [
      { "text": "Chốt kiến trúc X", "confidence": "high", "evidence": "phút 12:30" }
    ],
    "aiSummary": { "keyPoints": ["Điểm đã sửa tay"], "risks": ["Rủi ro R1"] }
  }' | jq '.data | {versionNo, decisionsJson, aiSummaryJson}'
```

Kỳ vọng: `versionNo` +1; `decisionsJson[0]` giữ nguyên `confidence/evidence`; `aiSummaryJson.keyPoints/risks` cập nhật, **`aiSummaryJson.meta` giữ nguyên** provider/model/generatedByJobId.

- Gửi field lạ (vd `"foo": 1`) → **400** validation.
- Sai `versionNo` → **409** `MINUTES_VERSION_CONFLICT`.

## 3. Badge AI trên danh sách (R4)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/meeting-minutes?limit=20" | jq '.data[] | {id, title, isAiGenerated}'
```

Kỳ vọng: nháp AI có `isAiGenerated=true`, nháp tay `false`.

## 4. Resume theo dõi job AI theo meeting (R5)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/meetings/$MEETING_ID/minutes/ai-draft-jobs | jq '.data[] | {jobId, status, startedAt, completedAt, result}'
```

Kỳ vọng: mảng job AI của meeting sắp xếp theo timeline (job vừa tạo / đang chạy lên đầu); job `completed` có `result.minutesId`. Non-owner/non-admin → **403**; meeting chưa chạy AI → `data: []`.

## 5. Chạy test

```bash
npx jest src/modules/minutes
npx tsc --noEmit -p tsconfig.build.json
```

## 6. Troubleshooting

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `aiSummary=null` dù là nháp AI | `ai_summary_json` chưa được ghi (job chưa completed) | Poll `GET /background-jobs/:jobId` tới `completed` rồi đọc lại |
| PATCH 400 khi gửi lại decisions của AI | Còn field lạ ngoài schema giàu | Chỉ gửi `text/confidence/evidence/responsibleUserId` (decisions), `task/owner/assigneeUserId/deadline/priority/confidence` (actionItems) |
| `meta` bị mất sau sửa tay | Client tự gửi `aiSummary.meta` | `meta` là read-only; service bỏ qua, chỉ merge 4 mảng |
| Endpoint list job 403 | Không phải Host/Admin của meeting | Dùng token Host hoặc Admin |
