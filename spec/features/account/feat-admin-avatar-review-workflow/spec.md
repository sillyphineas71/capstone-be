# 📝 CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-06-24 | Khoi tao dac ta tinh nang Admin Biometric Review Workflow | Toan bo tai lieu |
| 2026-06-24 | (1) Sua toan bo loi encoding, khoi phuc tieng Viet co dau. (2) Chuan hoa model face_profiles. (3) Chuan hoa audit action. (4) Chuan hoa notification transaction. | FR-011, FR-012, FR-013, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-035, NFR-009, AC-002, AC-003, AC-010, AC-011, MUC 5.2, 5.3, 5.4, 11.2, 12.1, 13.1, 13.2, 14, 20 |
| 2026-06-24 | CLARIFY-APPLY: Ap dung 13 quyet dinh clarify. Them BR-BIOMETRIC-URL. Authorization role+permission. sortBy whitelist. status filter 3 values. limit max 100. reason NFC+trim. audit_logs payload mau. transaction check user. AC concurrent. error codes moi. detail endpoint bo imageUrl. WebSocket OOS. | Q-BL-01, Q-BL-02, Q-AR-01, Q-VL-01, Q-VL-02, Q-DM-01, Q-DM-02, Q-EC-01, Q-EC-02, Q-AC-01, Q-AC-02, Q-SB-01, Q-SB-02. Toan bo 17 sections cap nhat. |
| 2026-06-24 | RECLARIFY-APPLY: primary, queued, search ILIKE, deptId, NULLS LAST, JSONB array, auth order (JWT->role->UUID->lookup), error codes INVALID_SEARCH_QUERY+INVALID_DEPARTMENT_ID, 5 AC moi, fix format. | Items 1-11, toan bo spec. |
| 2026-06-24 | RECLARIFY-FIX: format recipientJson = jsonb_build_array(:targetUserId). AC-007 require auth + UUID valid before 404. | Section 8 AC-007, Section 12.1 recipientUserIdsJson, Section 13.2 transaction note. |
| 2026-07-29 | DRIFT-FIX: sua OOS-005 va Authorization Rules cho khop thuc te code — migration `20260727000006-GrantManagerAvatarReviewPermission.ts` da cap quyen `account.biometric.review`/`account.biometric.download` cho role `MANAGER`. Xac nhan MANAGER duoc phep duyet (dung yeu cau nghiep vu goc: "van qua buoc manager duyet"). Xem ke hoach doi ten toan bo feature nay sang "biometric" tai `spec/features/account/feat-split-avatar-and-biometric/plan.md` va `tasks.md` (T08) — CHUA ap dung trong lan sua nay, chi sua drift OOS-005. | Muc 2.2, 2.3, 9.2 (OOS-005) |
| 2026-07-29 | T08 (feat-split-avatar-and-biometric/tasks.md): doi ten toan bo feature sang bien the "biometric" dung ban chat (Feature ID ACCT-BIOMETRIC-REVIEW-001, endpoint `/admin/biometric-submissions*`, error code `BIOMETRIC_*`, audit action `biometric.approve/reject/download`, notification_type `biometric_rejected`, permission `account.biometric.review/download`). XOA hanh vi tu dong cap nhat `users.avatar_url` khi approve (FR-007 sua doi, BR-BIOMETRIC-URL danh dau obsolete, bo buoc 6 trong FR-027/13.1 transaction, bo `avatarUrlUpdated` khoi audit payload, sua AC-002/AC-002b, sua data model 5.1/11.2/11.3, sua notification text 12.1 tu "anh dai dien" thanh "anh sinh trac hoc") theo quyet dinh D2 tai `feat-split-avatar-and-biometric/plan.md`. Them MANAGER vao bang Role o toan bo API Contract (muc 6) va permission seed note (muc 10.3) cho dong bo voi DRIFT-FIX. | Toan bo tai lieu: header, 1.1-1.4, 1.6 (Q-BL-01), 3.1 (FR-006/007/BR-BIOMETRIC-URL), 3.4-3.9, 3.6 (FR-027), 4, 5.1, 5.3, 5.4, 6 (6.1-6.5), 7, 8 (AC-002/002b va toan bo ma loi), 9, 10.3, 11.1-11.3, 12.1-12.2, 13.1-13.2, 14 |

# Feature Specification: Admin Biometric Review Workflow

- **Feature ID**: ACCT-BIOMETRIC-REVIEW-001
- **Feature Name**: Admin Biometric Review Workflow
- **Module / Domain**: accounts (Quan ly tai khoan & Face Profile)
- **Created Date**: 2026-06-24
- **Status**: Draft — Clarified
- **Source Documents**:
  - AGENTS.md (Database v3.2 Compact, Business Rules, Permission naming)
  - API_CONTRACT_v1.0_with_system_roles.md (System roles, Response format)
  - Database v3.2 Compact (face_profiles, users, media_files, notifications, audit_logs)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md (No-new-table rule, UUID PK, TypeORM)
  - Dependencies: feat-user-biometric-submission-reminder (shared contract)

---
---

## 1. Context & Goal

### 1.1 Boi canh

Tinh nang nay thuoc module `accounts`. Du an chuan bi cho chuc nang nhan dien khuon mat trong tuong lai (qua Door Face Attendance Terminal), do do can dam bao anh khuon mat/biometric cua nguoi dung trong he thong dat chat luong yeu cau.

Hien tai, user co the upload anh dai dien qua feature `feat-user-biometric-submission-reminder`. Anh sau khi upload duoc luu vao `media_files` va mot ban ghi `face_profiles` moi duoc tao voi `status = pending_review`. Tuy nhien, chua co co che de System Administrator kiem tra va phe duyet/tu choi anh do.

Feature nay cung cap cho System Administrator (SYSTEM_ADMIN) mot workflow quan ly tap trung de:
- Xem danh sach biometric dang cho duyet.
- Xem chi tiet submission va anh da upload.
- Tai anh ve kiem tra chat luong.
- Approve biometric neu anh hop le.
- Reject biometric neu anh khong dat, kem ly do va gui thong bao cho user.

### 1.2 Muc tieu

Muc tieu cua tinh nang nay la cho phep **System Administrator** thuc hien **duyet hoac tu choi anh dai dien/face profile cua nguoi dung dang cho xu ly**, nham **dam bao chat luong anh khuon mat trong he thong va kiem soat du lieu dau vao cho tinh nang nhan dien khuon mat trong tuong lai**.

### 1.3 Gia tri mang lai

- **Cho System Administrator**: Co giao dien tap trung de kiem tra va phe duyet/tu choi biometric, dam bao kiem soat chat luong.
- **Cho user**: Nhan duoc phan hoi ro rang khi anh bi tu choi (kem ly do), biet can upload lai anh khac.
- **Cho he thong**: Du lieu face profile duoc quan ly chat che, tach biet hoan toan khoi avatar hien thi (`users.avatar_url`) — xem `feat-split-avatar-and-biometric/plan.md` quyet dinh D2. Feature nay chi thay doi `face_profiles.status`, KHONG bao gio ghi `users.avatar_url`.
- **Cho audit**: Moi thao tac approve/reject/download deu co audit log day du.

### 1.4 Gia dinh

- System Administrator da dang nhap thanh cong va co JWT Access Token hop le.
- Tinh nang upload biometric cua user (`feat-user-biometric-submission-reminder`) da duoc trien khai va tao ra cac ban ghi `face_profiles` moi voi `status = pending_review` moi lan user submit anh.
- `face_profiles.status` hien tai nhan cac gia tri: `pending_review`, `active`, `disabled`, `revoked`. Can bo sung `rejected`.
- `face_profiles.metadata_json` duoc dung de luu rejection reason.
- `notifications` da ho tro `notification_type` (can them `biometric_rejected`).
- User khong bi block khoi he thong vi chua upload biometric hoac biometric bi reject.
- Permission `account.biometric.review` va `account.biometric.download` can duoc tao trong bang `permissions` neu chua co.
- Storage adapter (Cloudinary/MinIO) san sang cung cap URL tai anh cho muc dich download/kiem tra chat luong (khong lien quan `users.avatar_url` — field do da tach sang feature `feat-update-avatar-photo`, xem DRIFT-FIX 2026-07-29).
- Upload/anh duoc quan ly qua `media_files` voi `related_entity_type = 'face_profile'` va `related_entity_id = faceProfileId`.
- Audit logging da co san module/service trong he thong.
- **Model submission**: Moi lan user submit anh moi hop le, he thong tao mot `face_profiles` row moi voi `status = pending_review`. User co the co nhieu row `face_profiles` (1 active + 1+ pending/rejected). Feature nay nhan vao `faceProfileId` cua row dang `pending_review` va approve/reject tren row do.

### 1.5 Can lam ro (Resolved)

Tat ca diem can lam ro da duoc giai quyet qua phien Clarify. Xem chi tiet tai **1.6 Business Rules Application Log**.

### 1.6 Business Rules Application Log

| Rule ID | Quyet dinh | Ap dung vao |
|---|---|---|
| Q-BL-01 | [OBSOLETE 2026-07-29 — xem DRIFT-FIX] `users.avatar_url` SHALL store permanent display URL. KHONG luu signed URL, temporary URL, raw storage key, hoac internal path. Rule nay ban dau ap dung cho feature nay; nay khong con lien quan vi feature nay khong con ghi `users.avatar_url` (xem FR-006/FR-007 sua doi va `feat-update-avatar-photo` — noi ke thua trach nhiem avatar hien thi). | Muc 5.1, 5.3, 6.4, 9.1, 13.1 |
| Q-BL-02 | MVP KHONG implement WebSocket/realtime event cho approve/reject. Chi tao notification record trong DB. | Muc 9.1, 9.2, 12.1, 12.2 |
| Q-AR-01 | Authorization yeu cau **ca** role `SYSTEM_ADMIN` **va** permission code. Permission-only khong du. | Muc 2.2, 2.3, 3.1, 7, 8 |
| Q-VL-01 | Reject reason: trim + normalize NFC truoc validate. Max 500 Unicode characters, khong tinh bytes. | Muc 3.4, 5.2, 7, 8.2 |
| Q-VL-02 | sortBy allowlist server-side 6 fields. sortOrder chi nhan `asc`/`desc`. Khong interpolate input vao SQL. | Muc 6.1, 7, 8.2 |
| Q-DM-01 | `metadata_json.review` KHONG luu history array. Moi row `face_profiles` chi co 1 lifecycle. | Muc 5.2, 14 |
| Q-DM-02 | Audit log align voi schema `audit_logs` that: `user_id`, `action_type`, `entity_type`, `entity_id`, `old_value_json`, `new_value_json`, `severity`, `metadata_json`. | Muc 5.4, 13.1, 13.2, 8.5 |
| Q-EC-01 | Kiem tra user ton tai/deleted nam **trong** transaction (`SELECT ... FOR UPDATE`). | Muc 13.1, 13.2, 14 |
| Q-EC-02 | Concurrent approve/reject: row locking + status validation dam bao tu tu. Admin thu 2 nhan 409. | Muc 8.6, 14 |
| Q-AC-01 | `expiresAt` la ISO 8601/RFC3339 string co timezone offset. Khong dung Unix timestamp. | Muc 6.3, 8.1 |
| Q-AC-02 | `status` filter chi nhan 3 gia tri: `pending_review`, `rejected`, `active`. Default `pending_review`. | Muc 6.1, 7, 8.2 |
| Q-SB-01 | Pagination: default 20, max 100. Neu limit > 100 tra 422 `INVALID_PAGINATION_LIMIT`. | Muc 6.1, 7, 8.2 |
| Q-SB-02 | GET detail KHONG tra signed `imageUrl`. Chi tra metadata ve file anh. Muon xem/tai => goi `/download-url`. | Muc 6.2, 9.1 |

---

## 2. Actor & Roles

### 2.1 Danh sach actor

| Actor | Vai tro trong tinh nang | Quyen / Trach nhiem chinh |
|---|---|---|
| System Administrator | Actor chinh thuc hien review, approve, reject biometric | Xem danh sach pending, xem chi tiet, tai anh, approve, reject, ghi audit |
| User (nguoi upload biometric) | Actor thu dong nhan ket qua duyet | Nhan notification record khi biometric bi reject; upload lai anh neu can |
| Notifications Service | Actor he thong tao in-app notification record | Tao notification record trong DB cung transaction reject |
| Audit Logging Service | Actor he thong ghi audit trail | Ghi audit cho approve/reject/download trong transaction |

### 2.2 Authorization Rules

Authorization yeu cau **ca 2 dieu kien**: role (`SYSTEM_ADMIN` hoac `MANAGER`) **va** permission code tuong ung.

> **[DRIFT-FIX 2026-07-29]** Ban dau spec nay chi cho `SYSTEM_ADMIN`. Migration `20260727000006-GrantManagerAvatarReviewPermission.ts` da cap them quyen nay cho `MANAGER`, dung theo yeu cau nghiep vu goc ("van qua buoc manager duyet"). Bang duoi day da cap nhat theo thuc te code.

| Endpoint | Role yeu cau | Permission yeu cau |
|---|---|---|
| `GET /api/v1/admin/biometric-submissions` | `SYSTEM_ADMIN` hoac `MANAGER` | `account.biometric.review` |
| `GET /api/v1/admin/biometric-submissions/{faceProfileId}` | `SYSTEM_ADMIN` hoac `MANAGER` | `account.biometric.review` |
| `GET /api/v1/admin/biometric-submissions/{faceProfileId}/download-url` | `SYSTEM_ADMIN` hoac `MANAGER` | `account.biometric.download` |
| `POST /api/v1/admin/biometric-submissions/{faceProfileId}/approve` | `SYSTEM_ADMIN` hoac `MANAGER` | `account.biometric.review` |
| `POST /api/v1/admin/biometric-submissions/{faceProfileId}/reject` | `SYSTEM_ADMIN` hoac `MANAGER` | `account.biometric.review` |

| Permission Code | Mo ta | Gan cho role |
|---|---|---|
| `account.biometric.review` | Xem danh sach, xem chi tiet, approve, reject biometric submission | `SYSTEM_ADMIN`, `MANAGER` |
| `account.biometric.download` | Tai/xem URL anh goc biometric submission | `SYSTEM_ADMIN`, `MANAGER` |

INTERNAL_USER, BUSINESS_ADMIN khong co quyen review/approve/reject biometric trong MVP. MANAGER duoc phep (xem DRIFT-FIX tren).

### 2.3 Actor Constraints & Auth Order

- System Administrator/Manager phai co JWT token hop le (authenticated).
- System Administrator/Manager phai co role `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2).
- System Administrator/Manager phai co permission tuong ung (`account.biometric.review` hoac `account.biometric.download`).
- User target phai ton tai trong he thong, `account_status = 'active'`, va khong bi soft delete.

**Authorization evaluation order (moi endpoint):**

1. **JWT authentication** => 401 `UNAUTHORIZED` neu token missing/invalid/expired.
2. **Role + permission check** => 403 `FORBIDDEN` neu thieu `SYSTEM_ADMIN` role hoac thieu permission. Check nay chay truoc khi validate UUID hoac lookup resource.
3. **UUID validation** => 422 `VALIDATION_ERROR` neu `faceProfileId` khong phai UUID hop le.
4. **Resource lookup** => 404 `BIOMETRIC_SUBMISSION_NOT_FOUND` neu khong ton tai.

Voi `/download-url`: thieu permission `account.biometric.download` => 403 `FORBIDDEN` cho du `faceProfileId` khong ton tai.

---

## 3. Functional Requirements

> Tat ca Functional Requirements viet theo EARS.
> Keyword EARS giu bang tieng Anh.
> Noi dung nghiep vu viet tieng Viet.

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL chi cho phep System Administrator co role `SYSTEM_ADMIN` **va** permission `account.biometric.review` truy cap cac endpoint review/approve/reject biometric submission.

FR-002: THE system SHALL chi cho phep System Administrator co role `SYSTEM_ADMIN` **va** permission `account.biometric.download` truy cap endpoint download URL biometric submission.

FR-003: THE system SHALL su dung `face_profiles` lam source of truth cho trang thai review cua biometric.

FR-004: THE system SHALL KHONG tao bang moi cho feature nay; chi su dung cac bang hien co: `face_profiles`, `users`, `media_files`, `notifications`, `audit_logs`.

FR-005: THE system SHALL ho tro trang thai `rejected` cho `face_profiles.status` de phuc vu luong reject.

FR-006: THE system SHALL KHONG cap nhat `users.avatar_url` khi biometric bi reject.

FR-007 [SUA 2026-07-29 — xem DRIFT-FIX]: THE system SHALL KHONG bao gio cap nhat `users.avatar_url` tu luong duyet sinh trac hoc nay, ke ca khi approve. `users.avatar_url` la du lieu avatar hien thi, duoc quan ly hoan toan doc lap boi feature `feat-update-avatar-photo` (khong duyet), khong con lien quan gi den ket qua approve/reject o feature nay. (Ban cu cua FR-007 mo ta hanh vi nguoc lai — da bi loai bo theo quyet dinh D2 tai `feat-split-avatar-and-biometric/plan.md`.)

BR-BIOMETRIC-URL [OBSOLETE 2026-07-29 — xem DRIFT-FIX]: Rule nay (rang buoc dinh dang cho `users.avatar_url`: permanent display URL, khong phai signed/temporary URL) khong con ap dung cho feature nay vi feature nay khong con ghi field `users.avatar_url`. Neu can rang buoc tuong tu cho avatar hien thi, xem spec `feat-update-avatar-photo`.

### 3.2 Event-driven Requirements

FR-008: WHEN System Administrator gui yeu cau GET danh sach biometric submissions co query `status=pending_review`, THE system SHALL tra ve danh sach cac face profiles dang cho duyet kem thong tin user summary, co ho tro pagination (`page`, `limit` voi max 100), filter (`status`, `q`, `departmentId`), va sort (`sortBy` whitelist 6 fields, `sortOrder` chi `asc`/`desc`).

FR-009: WHEN System Administrator gui yeu cau GET chi tiet submission voi `faceProfileId` hop le, THE system SHALL tra ve thong tin day du: user summary, face profile status, image metadata (file name, mime type, file size, storage provider), submitted time, consent time va review metadata (neu co). Response KHONG chua signed `imageUrl`; muon xem/tai anh bat buoc goi `/download-url`.

FR-010: WHEN System Administrator gui yeu cau GET download URL voi `faceProfileId` hop le va role `SYSTEM_ADMIN` + permission `account.biometric.download`, THE system SHALL tao va tra ve signed/temporary URL (TTL 5-15 phut), `expiresAt` dinh dang ISO 8601 co timezone offset, dong thoi ghi audit log `biometric.download`.

FR-011: WHEN System Administrator gui yeu cau POST approve voi `faceProfileId` hop le, submission `pending_review`, va user target ton tai/active/not-deleted, THE system SHALL approve trong transaction (Muc 13.1).

FR-012: WHEN System Administrator gui yeu cau POST reject voi `faceProfileId` hop le, submission `pending_review`, user ton tai, va `reason` hop le (trim+NFC, max 500 Unicode chars), THE system SHALL reject trong transaction kem notification record (Muc 13.2).

FR-013: WHEN reject transaction commit thanh cong, notification record da duoc tao trong DB voi `notification_type = 'biometric_rejected'`, `channel = 'in_app'`, recipient la user so huu.

### 3.3 State-driven Requirements

FR-014: WHILE `face_profiles.status = 'pending_review'`, THE system SHALL cho phep System Administrator thuc hien approve hoac reject submission.

FR-015: WHILE `face_profiles.status = 'active'`, THE system SHALL KHONG cho phep approve lai hoac reject.

FR-016: WHILE `face_profiles.status = 'rejected'`, THE system SHALL KHONG cho phep reject lai hoac approve (terminal state).

FR-017: WHILE `face_profiles.status = 'disabled'` hoac `'revoked'`, THE system SHALL KHONG cho phep thao tac approve/reject.

### 3.4 Unwanted Behavior Requirements

FR-018: IF `faceProfileId` khong ton tai, THEN THE system SHALL tra 404 `BIOMETRIC_SUBMISSION_NOT_FOUND`.

FR-019: IF submission khong o `pending_review`, THEN THE system SHALL tra 409 `BIOMETRIC_SUBMISSION_NOT_PENDING`.

FR-020: IF reject `reason` missing hoac rong sau trim, THEN THE system SHALL tra 422 `BIOMETRIC_REJECTION_REASON_REQUIRED`.

FR-021: IF reject `reason` sau trim+NFC co length > 500 Unicode characters, THEN THE system SHALL tra 422 `BIOMETRIC_REJECTION_REASON_TOO_LONG`.

FR-022: IF user so huu face profile khong ton tai, `account_status != 'active'`, hoac `deleted_at` IS NOT NULL, THEN THE system SHALL tu choi approve/reject va tra 404 `USER_NOT_FOUND`.

FR-023: IF file anh trong `media_files` khong ton tai, khong the truy xuat, hoac `primary_image_file_id` IS NULL, THEN THE system SHALL:
  - Khi GET `/download-url` hoac GET detail: tra 404 `BIOMETRIC_MEDIA_NOT_FOUND`.
  - Khi POST `/approve`: tra 500 `BIOMETRIC_APPROVE_FAILED` (data integrity error).

FR-024: IF storage adapter loi khi tao signed URL, THEN THE system SHALL tra 500 `BIOMETRIC_DOWNLOAD_URL_FAILED`.

FR-025: IF System Administrator thieu role `SYSTEM_ADMIN` hoac thieu permission, THEN THE system SHALL tra 403 `FORBIDDEN`.

FR-026: IF user chua dang nhap hoac token het han, THEN THE system SHALL tra 401 `UNAUTHORIZED`.

### 3.5 Validation-specific Requirements

FR-036: WHEN `sortBy` duoc truyen trong query, THE system SHALL chi chap nhan cac gia tri trong whitelist: `submittedAt`, `userFullName`, `employeeCode`, `departmentName`, `status`, `qualityScore`. Neu khong hop le, tra 422 `INVALID_SORT_BY`.

FR-037: WHEN `sortOrder` duoc truyen, THE system SHALL chi chap nhan `asc` hoac `desc`. Neu khong hop le, tra 422 `INVALID_SORT_ORDER`.

FR-038: WHEN `status` duoc truyen trong list query, THE system SHALL chi chap nhan `pending_review`, `rejected`, `active`. Default `pending_review`. Neu khong hop le, tra 422 `INVALID_BIOMETRIC_SUBMISSION_STATUS`.

FR-039: WHEN `limit` > 100 duoc truyen, THE system SHALL tra 422 `INVALID_PAGINATION_LIMIT`. Default 20.

### 3.6 Transaction & Consistency Requirements

FR-027 [SUA 2026-07-29 — bo buoc cap nhat avatar_url, xem DRIFT-FIX]: WHEN approve biometric, THE system SHALL thuc hien trong transaction:
1. `SELECT ... FOR UPDATE` lock pending profile row
2. Validate `status = 'pending_review'`; neu sai rollback, tra 409
3. `SELECT ... FOR UPDATE` lock owning user row; validate user ton tai, `account_status = 'active'`, `deleted_at IS NULL`; neu khong rollback, tra 404
4. Tim old active face profile cung `user_id` (neu co): `UPDATE face_profiles SET status = 'revoked'`
5. `UPDATE face_profiles SET status = 'active'` cho pending profile
6. `INSERT INTO audit_logs` voi `action_type = 'biometric.approve'`
7. Commit
Neu bat ky buoc nao that bai, rollback toan bo. Transaction nay KHONG dong den `users.avatar_url` (ban cu co buoc `UPDATE users SET avatar_url = ...` — da bo theo quyet dinh D2).

FR-028: WHEN reject biometric, THE system SHALL thuc hien trong transaction:
1. `SELECT ... FOR UPDATE` lock pending profile row
2. Validate `status = 'pending_review'`; neu sai rollback, tra 409
3. `SELECT ... FOR UPDATE` lock owning user row; validate user ton tai
4. `UPDATE face_profiles SET status = 'rejected', metadata_json = jsonb_set(...), updated_at = NOW()`
5. `INSERT INTO audit_logs` voi `action_type = 'biometric.reject'`
6. `INSERT INTO notifications` voi `notification_type = 'biometric_rejected'`, `channel = 'in_app'`, `related_entity_type = 'face_profile'`, `related_entity_id = faceProfileId`
7. Commit
Neu insert notifications that bai, rollback toan bo reject transaction.

### 3.7 Audit Requirements

FR-029: THE system SHALL ghi `audit_logs` cho `biometric.download` voi payload (Muc 5.4).

FR-030: THE system SHALL ghi `audit_logs` cho `biometric.approve` voi payload (Muc 5.4).

FR-031: THE system SHALL ghi `audit_logs` cho `biometric.reject` voi payload (Muc 5.4).

### 3.8 Notification Requirements

FR-032: THE system SHALL tao `notifications` record trong cung transaction reject (buoc bat buoc).

FR-033: WHERE email notification duoc cau hinh (optional/future), THE system SHALL co the gui them email. Trong MVP, chi tao in-app notification record trong DB.

### 3.9 Data Requirements

FR-034: WHEN reject, THE system SHALL luu rejection reason vao `face_profiles.metadata_json` duoi `{"review": {"rejectionReason": "...", "reviewedBy": "userId", "reviewedAt": "timestamp"}}`. KHONG dung history array.

FR-035: WHEN approve va user co old active face profile, THE system SHALL chuyen old active thanh `revoked` trong cung transaction, dam bao chi 1 active profile.

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL tra ve danh sach biometric submissions trong vong duoi 2 giay voi page size mac dinh 20, du lieu khong qua 10,000 ban ghi.

NFR-002: THE system SHALL ho tro it nhat 5 System Administrator thao tac dong thoi.

### 4.2 Security

NFR-003: THE system SHALL yeu cau JWT authentication truoc khi cho phep truy cap endpoint admin biometric review.

NFR-004: THE system SHALL kiem tra ca role `SYSTEM_ADMIN` va permission (`account.biometric.review` / `account.biometric.download`) cho moi request.

NFR-005: THE system SHALL KHONG expose storage secret key, internal storage path, hoac raw storage URL trong API response.

NFR-006: THE system SHALL su dung signed URL co TTL (5-15 phut) cho download URL. `users.avatar_url` luon la permanent display URL, khong phai signed URL.

### 4.3 Reliability & Consistency

NFR-007: THE system SHALL dam bao approve/reject idempotency qua row-level locking (`FOR UPDATE`) va status validation.

NFR-008 [SUA 2026-07-29]: THE system SHALL dam bao consistency giua `face_profiles.status`, audit log va notification record trong approve/reject transaction. (Ban cu co nhac `users.avatar_url` — da bo vi feature nay khong con ghi field do.)

NFR-009: IF khong the tao notification record trong DB trong reject transaction, THEN toan bo reject transaction SHALL rollback. Delivery async (push/WebSocket) sau commit la optional; failure delivery khong rollback commit.

### 4.4 Observability

NFR-010: THE system SHALL ghi log server-side cho cac approve/reject/download error.

NFR-011: THE system SHALL ghi audit log cho `biometric.approve`, `biometric.reject`, `biometric.download` voi severity `info`.

---

## 5. Data Model

### 5.1 Entity lien quan

| Entity / Table | Vai tro trong tinh nang | Ghi chu |
|---|---|---|
| `face_profiles` | Source of truth cho trang thai review; luu submission status, rejection reason, primary image link | Bo sung status `rejected` |
| `users` | Cung cap thong tin user (full_name, email, department...) de hien thi trong danh sach/chi tiet review | [SUA 2026-07-29] KHONG con bi feature nay ghi `avatar_url` — xem DRIFT-FIX |
| `media_files` | Luu metadata anh, storage key, permanent URL | `file_url` dung de tao signed download URL, khong con lien quan `users.avatar_url` |
| `notifications` | Luu in-app notification record khi reject (cung transaction) | Bo sung `notification_type = biometric_rejected` |
| `audit_logs` | Ghi audit trail cho approve/reject/download | Align voi DB schema that (Muc 5.4) |

### 5.2 face_profiles.status state model

| Status | Y nghia | Co the chuyen sang | Dieu kien chuyen |
|---|---|---|---|
| `pending_review` | Anh dang cho admin duyet | `active`, `rejected` | Approve/reject boi SYSTEM_ADMIN |
| `active` | Face profile hop le, biometric da approve | `revoked`, `disabled` | Co pending moi duoc approve (revoked); hoac admin vo hieu hoa (disabled) |
| `rejected` | Anh bi tu choi, user can upload lai (tao row moi) | (terminal) | User upload lai => row moi `pending_review` |
| `disabled` | Admin vo hieu hoa | `active` (neu bat lai) | Admin action |
| `revoked` | Bi thu hoi do profile moi thay the | (terminal) | Khi approve pending profile moi cua cung user |

Rejection reason luu trong `metadata_json`:
```json
{
  "review": {
    "rejectionReason": "Anh bi mo",
    "reviewedBy": "adminUserId",
    "reviewedAt": "2026-06-24T10:15:00+07:00"
  }
}
```
KHONG co history array. Moi row `face_profiles` chi co toi da 1 review block.

### 5.3 Data Constraints

- Moi user chi co toi da 1 face profile `active` tai 1 thoi diem.
- De xuat: partial unique index `ux_face_profiles_user_pending` de gioi han 1 pending_review/user.
- `face_profiles.primary_image_file_id` FK den `media_files.id`.
- `face_profiles.user_id` FK den `users.id`.

### 5.4 Audit Log Schema Alignment

Spec align voi schema `audit_logs` that trong DB v3.2 Compact.

**biometric.approve** payload:
```
user_id = systemAdminId
action_type = 'biometric.approve'
entity_type = 'face_profile'
entity_id = faceProfileId
old_value_json = { "status": "pending_review" }
new_value_json = { "status": "active" }
metadata_json = { "targetUserId": "userId", "oldActiveFaceProfileId": "uuid-or-null", "mediaFileId": "uuid", "requestId": "request-id" }
severity = 'info'
```

**biometric.reject** payload:
```
user_id = systemAdminId
action_type = 'biometric.reject'
entity_type = 'face_profile'
entity_id = faceProfileId
old_value_json = { "status": "pending_review" }
new_value_json = { "status": "rejected" }
metadata_json = { "targetUserId": "userId", "reason": "Anh bi mo", "notificationCreated": true }
severity = 'info'
```

**biometric.download** payload:
```
user_id = systemAdminId
action_type = 'biometric.download'
entity_type = 'face_profile'
entity_id = faceProfileId
old_value_json = null
new_value_json = null
metadata_json = { "targetUserId": "userId", "mediaFileId": "uuid", "expiresAt": "2026-06-24T10:15:00+07:00" }
severity = 'info'
```

---

## 6. API Contract Draft

> Prefix: `/api/v1`
> Authorization: role `SYSTEM_ADMIN` + permission
> Tat ca response timestamps dinh dang ISO 8601/RFC3339 voi timezone offset.

### 6.1 GET /api/v1/admin/biometric-submissions

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/admin/biometric-submissions` |
| Role | `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2) |
| Permission | `account.biometric.review` |

**Query Parameters:**

| Param | Type | Required | Default | Mo ta | Validation |
|---|---|---|---|---|---|
| `status` | string | Khong | `pending_review` | Loc theo status | Chi nhan: `pending_review`, `rejected`, `active` |
| `page` | int | Khong | 1 | So trang | >= 1 |
| `limit` | int | Khong | 20 | So item moi trang | 1..100. Neu > 100 => 422 `INVALID_PAGINATION_LIMIT` |
| `q` | string | Khong | - | Tim kiem full_name, email, employee_code | Trim truoc khi dung. Empty => bo qua search. Min 2, max 100 Unicode chars. Neu sai length => 422 `INVALID_SEARCH_QUERY`. Search = parameterized `ILIKE '%value%'` tren `users.full_name`, `users.email`, `users.employee_code`. Khong interpolate vao SQL. |
| `departmentId` | UUID | Khong | - | Loc theo phong ban | Neu khong phai UUID => 422 `INVALID_DEPARTMENT_ID`. UUID hop le nhung dept khong ton tai hoac khong co du lieu => 200 `items=[]`. |
| `sortBy` | string | Khong | `submittedAt` | Field sort | Whitelist: `submittedAt`, `userFullName`, `employeeCode`, `departmentName`, `status`, `qualityScore`. Neu sai => 422 `INVALID_SORT_BY` |
| `sortOrder` | string | Khong | `desc` | Thu tu sort | Chi nhan `asc` hoac `desc`. Neu sai => 422 `INVALID_SORT_ORDER` |

**sortBy mapping (server-side allowlist):**
- `submittedAt` -> `fp.enrolled_at`
- `userFullName` -> `u.full_name`
- `employeeCode` -> `u.employee_code`
- `departmentName` -> `d.department_name`
- `status` -> `fp.status`
- `qualityScore` -> `fp.quality_score` (dung `NULLS LAST` khi sort)

**Response 200:**
```json
{
  "success": true,
  "message": "Danh sach biometric submissions",
  "data": [
    {
      "faceProfileId": "uuid",
      "userId": "uuid",
      "fullName": "Nguyen Van A",
      "email": "user@company.com",
      "employeeCode": "EMP-0001",
      "departmentName": "IT",
      "status": "pending_review",
      "submittedAt": "2026-06-23T10:00:00+07:00",
      "primaryImageFileId": "uuid",
      "qualityScore": null
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 10,
    "totalPages": 1
  }
}
```

### 6.2 GET /api/v1/admin/biometric-submissions/{faceProfileId}

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/admin/biometric-submissions/{faceProfileId}` |
| Role | `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2) |
| Permission | `account.biometric.review` |

Response KHONG chua signed `imageUrl`. Chi chua metadata ve file anh. Muon xem/tai => goi `/download-url`.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "faceProfileId": "uuid",
    "userId": "uuid",
    "userFullName": "Nguyen Van A",
    "userEmail": "a@company.com",
    "status": "pending_review",
    "primaryImageFileId": "uuid",
    "imageFile": {
      "fileName": "biometric.jpg",
      "mimeType": "image/jpeg",
      "fileSizeBytes": 204800,
      "storageProvider": "cloud_provider"
    },
    "hasPreview": true,
    "submittedAt": "2026-06-24T10:00:00+07:00",
    "consentAt": "2026-06-24T10:00:00+07:00",
    "reviewMetadata": null
  }
}
```

### 6.3 GET /api/v1/admin/biometric-submissions/{faceProfileId}/download-url

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/admin/biometric-submissions/{faceProfileId}/download-url` |
| Role | `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2) |
| Permission | `account.biometric.download` |
| Audit | Bat buoc: `action_type = 'biometric.download'` |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://signed-url-here",
    "expiresAt": "2026-06-24T10:15:00+07:00"
  }
}
```
`expiresAt` la ISO 8601/RFC3339 string voi timezone offset. Khong dung Unix timestamp.

### 6.4 POST /api/v1/admin/biometric-submissions/{faceProfileId}/approve

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/admin/biometric-submissions/{faceProfileId}/approve` |
| Role | `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2) |
| Permission | `account.biometric.review` |
| Audit | Bat buoc: `action_type = 'biometric.approve'` |
| Transaction | Toan bo trong transaction (Muc 13.1) |

Request Body: (empty)

**Response 200:**
```json
{
  "success": true,
  "message": "Biometric da duoc duyet thanh cong",
  "data": {
    "faceProfileId": "uuid",
    "userId": "uuid",
    "status": "active",
    "approvedAt": "2026-06-24T11:00:00+07:00"
  }
}
```

Luu y [SUA 2026-07-29]: `users.avatar_url` KHONG bi thay doi boi approve — avatar hien thi la du lieu doc lap, quan ly boi feature `feat-update-avatar-photo`.

### 6.5 POST /api/v1/admin/biometric-submissions/{faceProfileId}/reject

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/admin/biometric-submissions/{faceProfileId}/reject` |
| Role | `SYSTEM_ADMIN` hoac `MANAGER` (xem DRIFT-FIX muc 2.2) |
| Permission | `account.biometric.review` |
| Audit | Bat buoc: `action_type = 'biometric.reject'` |
| Notification | Tao notification record trong cung transaction |
| Transaction | Toan bo trong transaction (Muc 13.2) |

**Request Body:**
```json
{
  "reason": "Anh khong ro khuon mat, vui long upload lai."
}
```
Validation: trim + normalize NFC truoc validate. Max 500 Unicode characters.

**Response 200:**
```json
{
  "success": true,
  "message": "Biometric da bi tu choi",
  "data": {
    "faceProfileId": "uuid",
    "userId": "uuid",
    "status": "rejected",
    "rejectedAt": "2026-06-24T11:00:00+07:00"
  }
}
```
Luon => `users.avatar_url` khong bi thay doi.

---

## 7. Error Handling

### 7.1 Error Codes

| HTTP Status | Error Code | Mo ta |
|---:|---|---|
| 401 | `UNAUTHORIZED` | Chua dang nhap / token khong hop le |
| 403 | `FORBIDDEN` | Thieu role `SYSTEM_ADMIN` hoac thieu permission |
| 404 | `BIOMETRIC_SUBMISSION_NOT_FOUND` | `faceProfileId` khong ton tai |
| 404 | `USER_NOT_FOUND` | User so huu khong ton tai, `account_status != active`, hoac deleted |
| 404 | `BIOMETRIC_MEDIA_NOT_FOUND` | File anh goc khong ton tai hoac khong the truy xuat |
| 409 | `BIOMETRIC_SUBMISSION_NOT_PENDING` | Submission khong o trang thai `pending_review` |
| 422 | `BIOMETRIC_REJECTION_REASON_REQUIRED` | Thieu reason khi reject |
| 422 | `BIOMETRIC_REJECTION_REASON_TOO_LONG` | Reason vuot qua 500 Unicode characters (sau trim+NFC) |
| 422 | `INVALID_SORT_BY` | `sortBy` khong nam trong whitelist |
| 422 | `INVALID_SORT_ORDER` | `sortOrder` khong phai `asc` hoac `desc` |
| 422 | `INVALID_BIOMETRIC_SUBMISSION_STATUS` | `status` filter khong phai `pending_review`, `rejected`, hoac `active` |
| 422 | `INVALID_SEARCH_QUERY` | `q` khong thoa min 2 / max 100 Unicode chars |
| 422 | `INVALID_DEPARTMENT_ID` | `departmentId` khong phai UUID hop le |
| 422 | `INVALID_PAGINATION_LIMIT` | `limit` > 100 |
| 500 | `BIOMETRIC_DOWNLOAD_URL_FAILED` | Storage adapter loi khi tao signed URL |
| 500 | `BIOMETRIC_REJECT_FAILED` | Loi khong xac dinh khi reject |
| 500 | `BIOMETRIC_APPROVE_FAILED` | Loi khong xac dinh khi approve |

### 7.2 Error Response Format

```json
{
  "success": false,
  "message": "Mo ta loi",
  "error": {
    "code": "ERROR_CODE",
    "details": {}
  },
  "timestamp": "2026-06-24T10:00:00+07:00",
  "path": "/api/v1/admin/biometric-submissions/..."
}
```

---

## 8. Acceptance Criteria

### 8.1 Happy Path

AC-001 (list pending):
Given System Administrator co role `SYSTEM_ADMIN` va permission `account.biometric.review`,
When gui `GET /api/v1/admin/biometric-submissions?status=pending_review`,
Then he thong tra 200 kem danh sach face profile `pending_review`, thong tin user, va meta pagination.

AC-002 (approve khong co old active):
Given System Administrator co role+permission,
  And face profile A `pending_review`, user A khong co old active profile,
When gui `POST /api/v1/admin/biometric-submissions/{faceProfileA}/approve`,
Then he thong tra 200,
  And `faceProfiles[A].status = 'active'`,
  And `users.avatar_url` KHONG thay doi (feature nay khong con ghi field nay — sua 2026-07-29),
  And audit log `biometric.approve` duoc ghi.

AC-002b (approve co old active):
Given System Administrator co role+permission,
  And face profile A `pending_review`, user A co face profile B `active`,
When gui `POST /api/v1/admin/biometric-submissions/{faceProfileA}/approve`,
Then he thong tra 200,
  And `faceProfiles[A].status = 'active'`,
  And `faceProfiles[B].status = 'revoked'` (cung transaction),
  And `users.avatar_url` KHONG thay doi.

AC-003 (reject):
Given System Administrator co role+permission,
  And face profile A `pending_review`,
When gui `POST /api/v1/admin/biometric-submissions/{faceProfileA}/reject` voi `{ "reason": "Anh bi mo" }`,
Then he thong tra 200,
  And `faceProfiles[A].status = 'rejected'`,
  And `metadata_json` chua rejection reason,
  And notification record da duoc tao trong DB voi `notification_type = 'biometric_rejected'`,
  And `users.avatar_url` khong thay doi,
  And audit log `biometric.reject` duoc ghi.

AC-004 (download URL):
Given System Administrator co role `SYSTEM_ADMIN` va permission `account.biometric.download`,
  And face profile A co `primary_image_file_id` hop le,
When gui `GET /api/v1/admin/biometric-submissions/{faceProfileA}/download-url`,
Then he thong tra 200 kem `downloadUrl` (signed URL TTL 5-15 phut) va `expiresAt` (ISO 8601),
  And audit log `biometric.download` duoc ghi.

### 8.2 Validation Cases

AC-005 (reason missing):
When gui POST reject khong co `reason` hoac reason rong,
Then tra 422 `BIOMETRIC_REJECTION_REASON_REQUIRED`.

AC-006 (status not pending):
Given face profile A `active`,
When gui POST approve cho A,
Then tra 409 `BIOMETRIC_SUBMISSION_NOT_PENDING`.

AC-007 (not found after authorization):
Given user da authenticated,
  And user co role SYSTEM_ADMIN,
  And user co permission tuong ung voi endpoint dang goi,
  And faceProfileId la UUID hop le nhung khong ton tai trong DB,
When user goi endpoint detail/approve/reject/download-url tuong ung,
Then he thong tra 404 `BIOMETRIC_SUBMISSION_NOT_FOUND`.

AC-008 (sortBy invalid):
When gui `GET ...?sortBy=invalidField`,
Then tra 422 `INVALID_SORT_BY`.

AC-009 (limit > 100):
When gui `GET ...?limit=200`,
Then tra 422 `INVALID_PAGINATION_LIMIT`.

AC-010 (status filter invalid):
When gui `GET ...?status=all` hoac `status=revoked`,
Then tra 422 `INVALID_BIOMETRIC_SUBMISSION_STATUS`.

### 8.3 Authorization Cases

AC-011 (INTERNAL_USER):
Given INTERNAL_USER da dang nhap, khong co role `SYSTEM_ADMIN`,
When gui `GET /api/v1/admin/biometric-submissions`,
Then tra 403 `FORBIDDEN`.

AC-012 (UNAUTHORIZED):
Given user chua dang nhap,
When gui bat ky request den admin endpoints,
Then tra 401 `UNAUTHORIZED`.

AC-013 (SYSTEM_ADMIN thieu permission):
Given SYSTEM_ADMIN khong co permission `account.biometric.review`,
When gui `GET /api/v1/admin/biometric-submissions`,
Then tra 403 `FORBIDDEN`.

### 8.4 Notification Cases

AC-014 (notification in transaction):
Given reject thanh cong,
Then `notifications` record da duoc insert trong cung transaction voi:
  - `notification_type = 'biometric_rejected'`
  - `related_entity_type = 'face_profile'`
  - `related_entity_id = faceProfileA`
  - recipient la user so huu.

AC-015 (notification fail rollback):
Given reject transaction that bai (khong insert duoc notification),
Then toan bo transaction rollback,
  `face_profiles.status` khong thay doi,
  tra 500 `BIOMETRIC_REJECT_FAILED`.

### 8.5 Audit Cases

AC-016 (audit approve):
Given approve thanh cong,
Then `audit_logs` co `action_type = 'biometric.approve'`, `entity_type = 'face_profile'`, `entity_id = faceProfileId`, `old_value_json.status = 'pending_review'`, `new_value_json.status = 'active'`.

AC-017 (audit reject):
Given reject thanh cong,
Then `audit_logs` co `action_type = 'biometric.reject'`, `entity_type = 'face_profile'`, `entity_id = faceProfileId`, `old_value_json.status = 'pending_review'`, `new_value_json.status = 'rejected'`.

AC-018 (audit download):
Given download URL duoc tao,
Then `audit_logs` co `action_type = 'biometric.download'`, `entity_type = 'face_profile'`, `entity_id = faceProfileId`.

### 8.6 Concurrent Cases

AC-CONCURRENT-001:
Given face profile A `pending_review`,
  And Admin A gui approve request,
  And Admin B gan nhu dong thoi gui reject request cho cung faceProfileA,
When Admin A transaction commit truoc,
Then Admin B request SHALL nhan 409 `BIOMETRIC_SUBMISSION_NOT_PENDING`,
  And system SHALL KHONG tao duplicate audit log hoac duplicate notification cho Admin B request.

---



### 8.7 Additional Clarify Cases

AC-PRIMARY-NULL-APPROVE:
Given face profile A `pending_review` nhung `primary_image_file_id` IS NULL,
When gui `POST /api/v1/admin/biometric-submissions/{faceProfileA}/approve`,
Then he thong tra 500 `BIOMETRIC_APPROVE_FAILED`.

AC-PRIMARY-NULL-DOWNLOAD:
Given face profile A `pending_review` va `primary_image_file_id` IS NULL,
When gui `GET /api/v1/admin/biometric-submissions/{faceProfileA}/download-url`,
Then he thong tra 404 `BIOMETRIC_MEDIA_NOT_FOUND`.

AC-AUTH-ORDER-NO-PERM:
Given user co JWT hop le nhung thieu permission `account.biometric.download`,
When gui `GET /api/v1/admin/biometric-submissions/nonexistent-uuid/download-url`,
Then he thong tra 403 `FORBIDDEN` (truoc khi kiem tra `faceProfileId` co ton tai hay khong).

AC-SEARCH-ILIKE:
Given System Administrator co role `SYSTEM_ADMIN` + permission `account.biometric.review`,
When gui `GET /api/v1/admin/biometric-submissions?q=nguyen`,
Then he thong tra 200 kem danh sach user co `full_name`, `email`, hoac `employee_code` match `%nguyen%` (case-insensitive).

AC-DEPTID-EMPTY:
Given System Administrator co role `SYSTEM_ADMIN` + permission `account.biometric.review`,
  And `departmentId` la UUID hop le nhung department khong ton tai hoac khong co pending submission,
When gui `GET /api/v1/admin/biometric-submissions?departmentId=valid-uuid`,
Then he thong tra 200 voi `data = []`.

AC-LOCK-TIMEOUT:
Given face profile A `pending_review` va transaction infrastructure error xay ra (vi du lock timeout),
When gui POST approve/reject cho A,
Then he thong tra 500 `BIOMETRIC_APPROVE_FAILED` hoac `BIOMETRIC_REJECT_FAILED`, KHONG tra 409.


## 9. Out of Scope

Cac noi dung sau **khong thuoc pham vi** cua feature nay:

### 9.1 Khong trien khai trong feature nay

- User upload biometric. (Thuoc feat-user-biometric-submission-reminder).
- Login popup/reminder implementation phia frontend.
- Face recognition that, face detection, face embedding.
- Tao embedding vector, goi Face Server enrollment.
- Email notification cho reject (optional/future).
- BUSINESS_ADMIN approval (MANAGER duoc phep — xem DRIFT-FIX muc 2.2).
- Tu dong kiem tra chat luong anh bang AI/CV.
- Chan user su dung he thong khi chua co biometric approved.
- Batch approve/reject nhieu submission.
- Luu file binary vao DB.
- **WebSocket/realtime event moi cho approve/reject**: chi tao notification record trong DB, delivery async la optional.
- **Tra signed URL trong detail endpoint**: chi tra metadata, muon xem bat buoc goi `/download-url`.
- Luu signed URL hoac temporary URL vao `users.avatar_url`**: `users.avatar_url` luon permanent display URL.

### 9.2 Out-of-scope Guardrails (EARS)

OOS-001: THE system SHALL NOT implement user upload biometric API.
OOS-002: THE system SHALL NOT goi Face Server enrollment hoac face recognition khi approve biometric.
OOS-003: THE system SHALL NOT tao bang moi.
OOS-004: THE system SHALL NOT gui email notification trong MVP.
OOS-005: THE system SHALL NOT cho phep BUSINESS_ADMIN approve/reject biometric. [DRIFT-FIX 2026-07-29: MANAGER DUOC PHEP approve/reject, khac ban goc cua rule nay — dung theo yeu cau nghiep vu "van qua buoc manager duyet" va migration `20260727000006-GrantManagerAvatarReviewPermission.ts` da trien khai tren code/DB thuc te.]
OOS-006: THE system SHALL NOT implement WebSocket/realtime event moi cho biometric approve/reject.
OOS-007: THE system SHALL NOT tra signed `imageUrl` trong GET detail response.
OOS-008: THE system SHALL NOT luu signed URL, temporary URL, hoac storage secret trong `users.avatar_url`.

---

## 10. Schema Change Requirements

### 10.1 face_profiles.status values

Them `rejected` vao danh sach gia tri hop le.

Hien tai: `active`, `pending_review`, `disabled`, `revoked`
Can bo sung: `rejected`

### 10.2 notifications.notification_type

Them gia tri `biometric_rejected`.

### 10.3 permissions

| permission_code | module_code | action_code | permission_name |
|---|---|---|---|
| `account.biometric.review` | account | review | Xem va duyet/tu choi biometric |
| `account.biometric.download` | account | download | Tai anh biometric submission |

Seed `role_permissions` cho role `SYSTEM_ADMIN` va `MANAGER` (xem DRIFT-FIX muc 2.2 — migration `20260727000006-GrantManagerAvatarReviewPermission.ts` da cap them cho MANAGER tren code/DB thuc te).

### 10.4 Partial Unique Index (de xuat)

```sql
CREATE UNIQUE INDEX ux_face_profiles_user_pending
ON face_profiles(user_id)
WHERE status = 'pending_review' AND deleted_at IS NULL;
```

---

## 11. Dependencies / Integration Points

### 11.1 Dependencies

Thuoc vao `feat-user-biometric-submission-reminder` de co:
- Co che user upload + `media_files` record.
- API tao `face_profiles` row `pending_review`.
- Frontend doc `face_profiles.status` hien thi popup khi `rejected`.

### 11.2 Shared Contract (dong bo 2 feature)

| Field | Gia tri | Ghi chu |
|---|---|---|
| `face_profiles.status` | pending_review, active, rejected, disabled, revoked | rejected them o feature nay |
| `face_profiles.primary_image_file_id` | FK -> media_files.id | |
| `media_files.related_entity_type` | 'face_profile' | |
| `media_files.related_entity_id` | faceProfileId UUID | |
| `media_files.file_url` | Permanent display URL, dung de tao signed download URL | [SUA 2026-07-29] Khong con lien quan `users.avatar_url` |
| Model submission | Moi submit tao row moi | |

### 11.3 Integration Points

| Service/Module | Ghi chu |
|---|---|
| NotificationsService | INSERT notification record trong reject transaction (bat buoc) |
| AuditService | INSERT audit_log trong transaction (dong bo) |
| MediaFilesService | Lay file_url (permanent display URL) de tao signed download URL |
| Storage Adapter | Tao signed URL TTL cho download |

---

## 12. Notification Behavior

### 12.1 Reject

- `notification_type`: `biometric_rejected`
- `channel`: `in_app`
- Recipient: user so huu face profile
- Noi dung:
  - subject: "Anh sinh trac hoc khong duoc chap nhan" [SUA 2026-07-29: truoc day ghi "Anh dai dien", gay nham lan voi feature avatar rieng biet — xem DRIFT-FIX]
  - body: "Anh sinh trac hoc cua ban khong duoc chap nhan. Vui long nop lai anh khac."
  - Neu co rejection reason: them "Ly do: {reason}".
- **INSERT notification record trong reject transaction (bat buoc)**.
- Delivery async (push/WebSocket) sau commit la optional. Failure delivery khong rollback.
- MVP khong gui email.

### 12.2 Approve

- Khong gui notification. Frontend cap nhat biometric tu API profile/login.

---

## 13. Transaction & Consistency

### 13.1 Approve Transaction

```
BEGIN TRANSACTION;
  1. SELECT * FROM face_profiles WHERE id = :faceProfileId FOR UPDATE
  2. IF status != 'pending_review' THEN ROLLBACK --> 409
  3. SELECT * FROM users WHERE id = (SELECT user_id FROM face_profiles WHERE id = :faceProfileId) FOR UPDATE
  4. IF user not found OR account_status != 'active' OR deleted_at IS NOT NULL THEN ROLLBACK --> 404
  5. // Find and revoke old active
     UPDATE face_profiles SET status = 'revoked', updated_at = NOW()
     WHERE user_id = :userId AND status = 'active'
  6. UPDATE face_profiles SET status = 'active', updated_at = NOW()
     WHERE id = :faceProfileId
  7. INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
       old_value_json, new_value_json, severity, metadata_json)
     VALUES (:adminId, 'biometric.approve', 'face_profile', :faceProfileId,
       '{"status":"pending_review"}', '{"status":"active"}',
       'info', :metadataJson)
COMMIT;
```
[SUA 2026-07-29] Ban cu co buoc `UPDATE users SET avatar_url = ...` giua buoc 6 va 7 — da bo hoan toan theo quyet dinh D2 (`feat-split-avatar-and-biometric/plan.md`). Transaction approve nay KHONG con dong den bang `users`.

### 13.2 Reject Transaction

```
BEGIN TRANSACTION;
  1. SELECT * FROM face_profiles WHERE id = :faceProfileId FOR UPDATE
  2. IF status != 'pending_review' THEN ROLLBACK --> 409
  3. SELECT * FROM users WHERE id = (SELECT user_id FROM face_profiles WHERE id = :faceProfileId) FOR UPDATE
  4. IF user not found OR account_status != 'active' OR deleted_at IS NOT NULL THEN ROLLBACK --> 404
  5. // Trim + normalize NFC reject reason truoc khi luu
     reviewJson = jsonb_build_object('review',
       jsonb_build_object('rejectionReason', :reason, 'reviewedBy', :adminId, 'reviewedAt', :now))
  6. UPDATE face_profiles SET status = 'rejected',
       metadata_json = jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{review}', reviewJson),
       updated_at = NOW()
     WHERE id = :faceProfileId
  7. INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
       old_value_json, new_value_json, severity, metadata_json)
     VALUES (:adminId, 'biometric.reject', 'face_profile', :faceProfileId,
       '{"status":"pending_review"}', '{"status":"rejected"}',
       'info', :metadataJson)
  8. INSERT INTO notifications (notification_type, channel, subject, content,
       related_entity_type, related_entity_id, recipient_user_ids_json,
       delivery_status, priority, created_by, payload_json)
     VALUES ('biometric_rejected', 'in_app', :subject, :body,
       'face_profile', :faceProfileId, :recipientJson,
       'queued', 'normal', :adminId, :payloadJson)
COMMIT;
```
Neu insert notifications that bai (step 8), toan bo transaction rollback.

**Luu y format `:recipientJson`:**

`recipient_user_ids_json` la JSONB array chua UUID string cua nguoi nhan. **Khong dung object format.**

Dung:
```sql
recipient_user_ids_json = jsonb_build_array(:targetUserId)
```
Tuong duong TypeORM:
```ts
recipient_user_ids_json: [targetUserId]
```

Vi du gia tri luu trong DB:
```json
["550e8400-e29b-41d4-a716-446655440000"]
```

Khong dung:
```json
{ "userId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

## 14. Edge Cases

| Edge Case | Handling |
|---|---|
| User upload lan 2 khi da co pending_review | Thuoc feature upload. Block = BIOMETRIC_ALREADY_PENDING_REVIEW (de xuat). |
| Approve khi user co old active | Set old active -> revoked cung transaction. |
| Reject khi user co old active | Khong dong vao old active. `users.avatar_url` giu nguyen. |
| User bi reject upload lai | Tao row moi pending_review. Row cu giu nguyen rejected. |
| Approve transaction that bai | Rollback toan bo. |
| Reject transaction that bai (ke ca notification) | Rollback toan bo. `face_profiles.status` khong doi. |
| Storage adapter timeout download URL | 500 `BIOMETRIC_DOWNLOAD_URL_FAILED`. |
| Concurrent approve+reject (2 admin) | Row locking (`FOR UPDATE`). Admin 2 cho lock. Sau commit Admin 1, Admin 2 doc lai status khong con pending_review => 409. MVP khong set `lock_timeout`. Neu lock timeout/infrastructure error => 500 `BIOMETRIC_APPROVE_FAILED` hoac `BIOMETRIC_REJECT_FAILED`, khong map thanh 409. |
| Notification delivery fail after commit | Khong rollback. Log failure, retry sau. |
| `face_profiles.primary_image_file_id` null khi approve | Tra 500 `BIOMETRIC_APPROVE_FAILED` (data integrity error). Service can log chi tiet de debug. |
| `face_profiles.primary_image_file_id` null khi download-url hoac detail | Tra 404 `BIOMETRIC_MEDIA_NOT_FOUND`. |
