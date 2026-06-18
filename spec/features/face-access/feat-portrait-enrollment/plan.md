---
name: feat-portrait-enrollment-plan
description: Kế hoạch FPE-001 — StorageService.getFile + FaceProfileService (enroll + getPortraitBytes) + controller UC-17.
category: face-access
---

# Implementation Plan: Portrait Enrollment (FPE-001)

- **Feature ID**: FPE-001 · **Module**: accounts (+ storage) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo plan.md FPE-001 (getFile, FaceProfileService, controller FileInterceptor, env, tests). | Toàn bộ file |

---

## 1. Technical Context (verified)
- StorageModule @Global → accounts inject StorageService. `localPath`=STORAGE_LOCAL_PATH. saveFile có sẵn; thêm getFile.
- accounts.module forFeature đã có FaceProfileEntity. media_files entity ở recording → accounts INSERT/SELECT raw qua DataSource.
- Upload: FileInterceptor('file') (@nestjs/platform-express, multer memory → file.buffer).
- Mock-guard pattern (KHÔNG dùng @RequirePermissions của users.controller). KHÔNG migration. import .js.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Sửa | `storage/storage.service.ts` (+getFile) |
| Mới | `accounts/services/face-profile.service.ts` (enrollPortrait + getPortraitBytes) |
| Mới | `accounts/controllers/face-profile.controller.ts` (POST users/:userId/face-profile) |
| Sửa | `accounts/accounts.module.ts` (+controller +service) |
| Sửa | `config/env.validation.ts` (+FACE_PORTRAIT_MAX_BYTES) + .env.example |
| Mới (test) | storage.service.spec (+getFile), face-profile.service.spec, face-profile.controller.spec |

## 3. StorageService.getFile
```text
getFile(storageKey): Buffer
  base = path.resolve(localPath); resolved = path.resolve(localPath, storageKey);
  if !(resolved===base || resolved.startsWith(base+path.sep)) → throw Error('Invalid storage key');
  if !fs.existsSync(resolved) → throw Error('File not found');
  return fs.readFileSync(resolved);
```

## 4. FaceProfileService
```text
constructor(@InjectRepository(FaceProfileEntity) repo, DataSource, StorageService, ConfigService).
ALLOWED_MIME = ['image/jpeg','image/png'].

enrollPortrait(userId, file:{buffer,originalname,mimetype,size}, enrolledBy): {faceProfileId,mediaFileId,status}
  if !file → 400 VALIDATION_ERROR.
  if !ALLOWED_MIME.includes(mimetype) → 400 INVALID_FILE_TYPE.
  maxBytes = config.get('FACE_PORTRAIT_MAX_BYTES', 5242880); if size>maxBytes → 400 FILE_TOO_LARGE.
  saved = storage.saveFile({ buffer, originalName: file.originalname, folder:'face-profiles', mimeType:file.mimetype }).
  media = dataSource.query(INSERT media_files (... file_type='image', storage_provider='local', storage_key=saved.storageKey, file_size_bytes=String(size), uploaded_by=enrolledBy, related_entity_type='face_profile', related_entity_id=userId) RETURNING id).
  existing = repo.findOne({where:{userId}}).
  if existing: repo.update(existing.id, { primaryImageFileId: media.id, status:'pending_review', enrolledBy, lastUpdatedAt:now, sampleCount: existing.sampleCount+1 }); faceProfileId=existing.id.
  else: saved2 = repo.save(repo.create({ userId, profileCode:`FP-${short}`, status:'pending_review', primaryImageFileId:media.id, enrolledBy, enrolledAt:now, sampleCount:1 })); faceProfileId=saved2.id.
  return { faceProfileId, mediaFileId: media.id, status:'pending_review' }.

getPortraitBytes(userId): Buffer|null
  face = repo.findOne({where:{userId}}); if !face?.primaryImageFileId → null.
  rows = dataSource.query(SELECT storage_key, storage_provider FROM media_files WHERE id=$1, [primaryImageFileId]);
  m = rows[0]; if !m || m.storage_provider!=='local' → null.
  return storage.getFile(m.storage_key).
```

## 5. Controller
```text
@Controller() FaceProfileController + MockPermissionsGuard/@Permissions (local như recording).
@Post('users/:userId/face-profile') @HttpCode(201)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard) @Permissions('account.face.register')
  @UseInterceptors(FileInterceptor('file', { limits:{ fileSize: PORTRAIT_LIMIT } }))
  async enroll(@Param('userId', ParseUUIDPipe) userId, @UploadedFile() file, @Req() req:any):
    enrolledBy = req.user?.userId||sub||id||null;
    data = await service.enrollPortrait(userId, file, enrolledBy);
    return { success:true, message:'Face portrait enrolled', data };
PORTRAIT_LIMIT = Number(process.env.FACE_PORTRAIT_MAX_BYTES) || 5*1024*1024 (decoration-time).
```

## 6. Module + ENV
- accounts.module: +FaceProfileController (controllers), +FaceProfileService (providers/exports — B inject getPortraitBytes).
- env.validation: `FACE_PORTRAIT_MAX_BYTES: Joi.number().integer().min(1).default(5242880)`. .env.example.

## 7. Tests (mock, ≥80%)
- storage.service.spec (+getFile): ok (mock fs.readFileSync+existsSync) / traversal → throw (no read) / missing → throw.
- face-profile.service.spec: enroll happy (saveFile→media→face create) / mime 400 / size 400 / upsert update (existing) ; getPortraitBytes có/không.
- face-profile.controller.spec: passthrough envelope + thiếu file → 400.

## 8. DoD
```
[ ] getFile no-traversal + missing-throw
[ ] enrollPortrait (validate mime/size, saveFile, media_files insert, face_profiles upsert) + envelope 201
[ ] getPortraitBytes (bytes/null) export cho B
[ ] env FACE_PORTRAIT_MAX_BYTES; module wiring; tests ≥80%
[ ] build/lint/jest xanh; KHÔNG migration; mock-guard pattern
```

> Trạng thái: CHỜ REVIEW sau code (STOP code-review gate). Chưa commit.
