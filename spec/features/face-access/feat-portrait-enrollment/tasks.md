# Tasks: Portrait Enrollment (FPE-001)

- **Feature ID**: FPE-001 · **Module**: accounts (+ storage)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> UC-17 enroll portrait + StorageService.getFile + getPortraitBytes (cho B). Mock-guard, envelope thủ công, FileInterceptor, SEC-03 no-traversal, KHÔNG migration.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo tasks.md FPE-001. | Toàn bộ file |

---

## 1. StorageService.getFile
**File**: `storage/storage.service.ts` (sửa)
- [ ] getFile(storageKey): resolve + prefix-check trong localPath (no-traversal → throw); !exists → throw; readFileSync. **Ref**: FR-001, NFR-002.

## 2. FaceProfileService
**File**: `accounts/services/face-profile.service.ts` (mới)
- [ ] enrollPortrait: validate file/mime/size (400) → saveFile → INSERT media_files (image/local) → upsert face_profiles (pending_review). **Ref**: FR-002/003/004.
- [ ] getPortraitBytes(userId): face_profiles→media_files.storage_key→getFile; null nếu thiếu/non-local. **Ref**: FR-005.

## 3. Controller + Module + ENV
- [ ] `face-profile.controller.ts`: POST users/:userId/face-profile, JwtAuthGuard+MockPerm+@Permissions('account.face.register'), FileInterceptor('file'), ParseUUIDPipe, envelope 201.
- [ ] accounts.module: +controller +service (export service cho B).
- [ ] env FACE_PORTRAIT_MAX_BYTES (Joi 1 dòng) + .env.example.

## 4. Tests (mock, ≥80%)
- [ ] storage.service.spec (+getFile ok/traversal/missing).
- [ ] face-profile.service.spec (enroll happy/mime/size/upsert; getPortraitBytes có/không).
- [ ] face-profile.controller.spec (passthrough/thiếu file).

## 5. Verify
- [ ] build · lint per-file · jest (accounts + storage) + coverage. STOP code-review gate.

---
> Trạng thái: CHỜ REVIEW sau code.
