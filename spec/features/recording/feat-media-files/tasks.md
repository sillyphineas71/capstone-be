# Tasks: Media Files API (REC-006)

- **Feature ID**: REC-006 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> list/detail/playback(Range)/visibility. Theo contract (D-1..4). SEC path-traversal. Soft-delete. KHÔNG migration. Test MOCK fs+res.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md REC-006 (4 endpoint, DTO, seed read/play/manage). | Toàn bộ file |

---

## 1. DTOs
**File**: `recording/dto/list-media-query.dto.ts`, `visibility.dto.ts` (mới)
- [ ] ListMediaQueryDto: page?(int min1, def1), limit?(int min1 max100, def20), fileType?(string csv). **Ref**: FR-001/002.
- [ ] VisibilityDto: action @IsIn(['hide','soft_delete']); reason? @IsOptional @MaxLength. **Ref**: FR-009.

## 2. Service
**File**: `recording/services/media-files.service.ts` (mới)
- [ ] list(meetingId, q): WHERE meeting_id & deleted_at IS NULL [+fileType csv]; order uploaded_at DESC; getManyAndCount → summary[] + meta.
- [ ] detail(fileId): 404 nếu missing/deleted; full + metadataJson.
- [ ] resolvePlayback(fileId): 404 missing/deleted/non-local/null-key; SEC realpath+prefix-check → 404 traversal; existsSync → 404; trả {path,size,mimeType}.
- [ ] setVisibility(fileId, dto): 404 missing/deleted; hide→is_active=false; soft_delete→deleted_at=now; trả {fileId,isActive,updatedAt}. **Ref**: FR-003..010, NFR-001/002.

## 3. Controller
**File**: `recording/controllers/media-files.controller.ts` (mới)
- [ ] GET meetings/:meetingId/media-files (read) → list.
- [ ] GET media-files/:fileId (read) → detail.
- [ ] GET media-files/:fileId/playback (play, @Res raw): Range 200/206/416 + Accept-Ranges + Content-Type; stream error → 500 không lộ path. **Ref**: FR-005..008, NFR-005.
- [ ] PATCH media-files/:fileId/visibility (manage) → setVisibility.
- [ ] MockPermissionsGuard + @Permissions như REC-002.

## 4. Module + Seed
- [ ] recording.module: +MediaFilesController +MediaFilesService.
- [ ] seed 20260615000009: recording.files.read + .play + .manage, ADMIN/MANAGER.

## 5. Tests (mock, ≥80%)
**File**: `recording/services/media-files.service.spec.ts` (mới)
- [ ] list (deleted filter + paginate + fileType + meta); detail (full + 404); resolvePlayback (ok / non-local / traversal→404 KHÔNG đọc / missing→404); visibility (hide/soft_delete/404/idempotent).

## 6. Verify
- [ ] build · lint per-file · jest modules/recording + coverage · boot smoke (4 route mapped + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
