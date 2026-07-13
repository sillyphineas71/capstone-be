# Implementation Plan: AI Draft Feature Availability (MKM-AI-03)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo plan cho feat-ai-draft-feature-flag dựa trên spec.md (2026-07-13) | Toàn bộ file |

**Branch**: `feat-ai-draft-feature-flag` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

---

## 1. Feature Summary

Thêm 1 endpoint đọc `GET /api/v1/meetings/:meetingId/minutes/ai-draft-config` trả tập con an toàn của `system_configs['ai.minutes_summary']` (`enabled`, `requireHumanReview`) để FE quyết định hiện/ẩn nút "Tạo bằng AI" và banner "cần review". Không đổi DB, không đổi worker, tái dùng toàn bộ hạ tầng ownership đã có từ MKM-AI-02.

## 2. Technical Context

### 2.1 Existing Codebase Analysis (đã xác minh 2026-07-13)

| Thành phần có sẵn | Đường dẫn | Vai trò tái sử dụng |
|---|---|---|
| `MinutesAiDraftService.loadConfig(manager)` | `services/minutes-ai-draft.service.ts:430` | Đọc `AiMinutesSummaryConfig`; gọi qua `this.dataSource.manager` (không cần transaction) |
| `MinutesAiDraftService.userHasAdminRole(userId)` | như trên | Check SYSTEM_ADMIN/BUSINESS_ADMIN — tái dùng y nguyên, không viết lại |
| `MinutesAiDraftService.listAiDraftJobs` | như trên | Pattern ownership Host-hoặc-Admin mẫu để copy 1:1 |
| `AI_MINUTES_ERROR_CODES.MEETING_NOT_FOUND / PERMISSION_DENIED` | `constants/ai-minutes-draft.constants.ts` | Đã tồn tại, không thêm error code mới |
| `MinutesAiDraftController` | `controllers/minutes-ai-draft.controller.ts` | Thêm 1 route `@Get` vào controller đã có 2 route meeting-scoped |

### 2.2 Cấu hình mới

Không có — endpoint chỉ đọc.

## 3. Scope Confirmation

### 3.1 In Scope

- 1 endpoint đọc + 1 DTO response + 1 service method.
- Unit test cho toàn bộ AC (spec mục 7).

### 3.2 Out of Scope

Xem spec.md mục 8.

### 3.3 Constitution Gate Check

| Gate | Kết quả |
| :--- | :--- |
| DB Gate | PASS — 0 bảng/cột/config key mới |
| Security Gate | PASS — chỉ trả 2 boolean, không lộ provider/model/token limit; ownership Host/Admin |
| Scope Gate | PASS — yêu cầu tường minh PO 2026-07-13; khóa bằng OOS-001→003 |
| Module Gate | PASS — code trong module `minutes`, không service/module mới |
| API Gate | PASS — route `GET /meetings/:meetingId/minutes/ai-draft-config`, response chuẩn `{success,message,data}` |
| Auth Gate | PASS — JwtAuthGuard + ownership ở service, không seed permission mới (đúng NFR-004) |
| Test Gate | Áp dụng — mục 5 |

## 4. Design

### 4.1 DTO

`dto/ai-draft-config.dto.ts`:
```ts
export class AiDraftConfigDto {
  enabled: boolean;
  requireHumanReview: boolean;
}
```

### 4.2 Service — `getAiDraftAvailability(meetingId, authUser)`

Copy structure của `listAiDraftJobs` (meeting lookup → ownership → trả dữ liệu), thay phần query job bằng đọc config:

```ts
async getAiDraftAvailability(meetingId, authUser): Promise<AiDraftConfigDto> {
  const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({ where: { id: meetingId } });
  if (!meeting || meeting.deletedAt) throw NotFoundException(MEETING_NOT_FOUND);

  if (meeting.hostId !== authUser.userId) {
    const isAdmin = await this.userHasAdminRole(authUser.userId);
    if (!isAdmin) throw ForbiddenException(PERMISSION_DENIED);
  }

  const config = await this.loadConfig(this.dataSource.manager); // tái dùng nguyên, truyền manager gốc
  return new AiDraftConfigDto({
    enabled: config?.enabled ?? false,
    requireHumanReview: config?.requireHumanReview ?? true,
  });
}
```

`loadConfig` hiện là `private` nhận `EntityManager` — `DataSource.manager` thỏa mãn type này nên gọi trực tiếp được, không cần transaction wrapper (chỉ đọc, không cần lock).

### 4.3 Controller

Thêm route thứ 3 vào `MinutesAiDraftController` (đã có `POST .../ai-draft-jobs`, `GET .../ai-draft-jobs`):

```ts
@Get('meetings/:meetingId/minutes/ai-draft-config')
@UseGuards(JwtAuthGuard)
async getAiDraftConfig(@Param('meetingId', ParseUUIDPipe) meetingId, @CurrentUser() user)
```

## 5. Test Strategy

| AC | Test |
|---|---|
| AC-001 | enabled=true, requireHumanReview=true |
| AC-002 | enabled=false (không throw) |
| AC-003 | config null → fail-safe {enabled:false, requireHumanReview:true} |
| AC-004 | meeting không tồn tại → 404 |
| AC-005 | non-owner/non-admin → 403 |
| AC-006 | BUSINESS_ADMIN không phải Host → 200 |

Chạy: `npx jest src/modules/minutes`. Build: `npx tsc --noEmit -p tsconfig.build.json`.

## 6. Definition of Done

- Toàn bộ AC mục 7 spec có test pass.
- `npx jest src/modules/minutes` xanh; build sạch.
- Docs đầy đủ + CHANGELOG.
- Không đổi DB/seed/worker.
- WIP local — không tự push (kế thừa MKM-AI-01/02).
