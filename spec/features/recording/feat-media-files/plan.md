---
name: feat-media-files-plan
description: Kế hoạch REC-006 — MediaFilesController/Service (list/detail/playback+Range/visibility) + seed perms.
category: recording
---

# Implementation Plan: Media Files API (REC-006)

- **Feature ID**: REC-006 · **Module**: recording · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md REC-006 (controller/service 4 endpoint, DTO, seed read/play/manage, tests mock fs+res). D-1..4 chốt. | Toàn bộ file |

---

## 1. Technical Context (RECON spec §2)
- UC-120/121 khớp; UC-122 playback = stream local + Range (lệch signed-url, D-1); UC-123 = PATCH visibility (D-2). Perm read/play/manage (D-3).
- media_files có deleted_at(@DeleteDateColumn) + is_active → soft-delete/hide. Streaming mới (@Res raw + fs.createReadStream). Pagination meta mẫu iot. DATA-01: KHÔNG migration.
- ConfigService cho RECORDING_STORAGE_PATH (SEC prefix-check). MockPermissionsGuard pattern như REC-002.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `recording/controllers/media-files.controller.ts` (4 route) |
| Mới | `recording/services/media-files.service.ts` (list/detail/playback/visibility) |
| Mới | `recording/dto/list-media-query.dto.ts`, `visibility.dto.ts` |
| Sửa | `recording/recording.module.ts` (+controller +service) |
| Mới (seed) | `database/seeds/20260615000009-SeedMediaFilesPermissions.ts` (read/play/manage) |
| Mới (test) | `media-files.service.spec.ts` |

## 3. DTOs
```ts
ListMediaQueryDto { page?=1 @IsInt min1; limit?=20 @IsInt min1 max100; fileType?:string @IsOptional } // csv
VisibilityDto { action: 'hide'|'soft_delete' @IsIn(['hide','soft_delete']); reason?: string @IsOptional @MaxLength }
```

## 4. Service
```text
list(meetingId, {page,limit,fileType}):
  qb media_files WHERE meeting_id & deleted_at IS NULL [+ fileType IN csv]; order uploaded_at DESC; skip/take.
  getManyAndCount → { items: summary[], meta {page,limit,total,totalPages} }.
detail(fileId):
  findOne id & deleted_at IS NULL; null → 404 MEDIA_FILE_NOT_FOUND; trả full (+metadataJson).
resolvePlayback(fileId): // service trả thông tin để controller stream
  load row (id & deleted_at null); null → 404. storage_provider!='local' || storage_key null → 404.
  base=realpathSync(resolve(RECORDING_STORAGE_PATH)); resolved=resolve(storage_key);
  !resolved.startsWith(base+sep) → 404 (path traversal). !existsSync(resolved) → 404.
  trả { path: resolved, size: statSync.size, mimeType }.
setVisibility(fileId, {action}):
  load row (id & deleted_at null); null → 404.
  hide → UPDATE is_active=false; soft_delete → UPDATE deleted_at=now.
  trả { fileId, isActive, updatedAt }.
```

## 5. Controller (playback @Res raw — Range)
```text
@Get('meetings/:meetingId/media-files') read → service.list.
@Get('media-files/:fileId') read → service.detail.
@Get('media-files/:fileId/playback') play, @Res() res:
  const m = await service.resolvePlayback(fileId);
  res.setHeader('Accept-Ranges','bytes'); res.setHeader('Content-Type', m.mimeType);
  range = req.headers.range; nếu range:
    parse 'bytes=start-end'; end default size-1; invalid/vượt → res.writeHead(416,{'Content-Range':`bytes */${size}`}); res.end().
    valid → res.writeHead(206,{Content-Range:`bytes ${start}-${end}/${size}`, Content-Length: end-start+1});
            createReadStream(path,{start,end}).pipe(res).
  không range → res.writeHead(200,{Content-Length:size}); createReadStream(path).pipe(res).
  stream.on('error') → nếu !res.headersSent res.status(500).end(); KHÔNG lộ path.
@Patch('media-files/:fileId/visibility') manage → service.setVisibility.
```

## 6. Seed
`recording.files.read` + `.play` + `.manage` (module recording, action files_read/play/manage), ADMIN/MANAGER.

## 7. Tests (mock, ≥80%)
- list: loại deleted (WHERE), paginate (skip/take + meta.totalPages), fileType csv, summary fields.
- detail: full + 404 (missing/deleted).
- playback (resolvePlayback unit + controller stream): 200 full headers / 206 range Content-Range/Length / 416 invalid / path-traversal '../..'→404 (KHÔNG đọc) / file-missing→404. mock fs.realpathSync/existsSync/statSync/createReadStream + fake res(writeHead/setHeader/status/end) + fake stream(pipe/on).
- visibility: hide→is_active false / soft_delete→deleted_at / 404 / idempotent.

## 8. [NEEDS CLARIFICATION]
- Không còn (D-1..4 chốt).

## 9. DoD
```
[ ] list (deleted filter + paginate + fileType + meta)
[ ] detail (full + 404)
[ ] playback (@Res Range 200/206/416 + SEC prefix-check + file-missing 404; không lộ path)
[ ] visibility (hide/soft_delete + 404 + idempotent)
[ ] DTOs validate; seed read/play/manage; module wiring
[ ] tests ≥80%; build/lint/jest/boot (4 route mapped, 0 DI) xanh
[ ] KHÔNG migration; soft-delete only
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
