# Tasks: Lưu credential RTSP mã hóa (IOT-015)

- **Feature ID**: IOT-015 · **Module**: iot (+ common, config)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> AES-256-GCM, lazy key. KHÔNG log plain/blob/key. KHÔNG lưu plaintext. KHÔNG đổi schema/DTO/endpoint.

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md IOT-015 (NC-1..3 chốt). | Toàn bộ file |

---

## 1. Util secret-crypto
**File**: `src/common/utils/secret-crypto.util.ts` (mới)
- [ ] `deriveKey()` lazy: `sha256(process.env.RTSP_CRED_KEY)` → 32 byte; thiếu key → throw.
- [ ] `encryptSecret(plain)`: iv=randomBytes(12); aes-256-gcm; blob=base64(iv‖tag‖ct).
- [ ] `decryptSecret(blob)`: tách iv/tag/ct; setAuthTag; throw nếu blob<28 byte hoặc tag sai. KHÔNG log.

**DoD**: round-trip OK; tamper→throw. **Ref**: FR-001/002/007, NFR-002.

## 2. Sửa configureRtsp
**File**: `src/modules/iot/services/iot-devices.service.ts` (sửa)
- [ ] import `encryptSecret`.
- [ ] `passwordProvided` → `encryptSecret` → `newRtspConfig.rtsp_password_encrypted` + `rtsp_password_configured=true`.
- [ ] không gửi → carry-over `rtsp_password_encrypted` + flag từ `currentRtspConfig`.
- [ ] KHÔNG lưu plaintext; streamUrl không kèm cred.

**DoD**: lưu encrypted/carry-over đúng. **Ref**: FR-003/004/005.

## 3. ENV
**File**: `src/config/env.validation.ts` (sửa) + `.env.example` (sửa) + `.env` local (sửa, không commit)
- [ ] Joi: section "Q. Recording Capture" + `RTSP_CRED_KEY: Joi.string().min(32).required()`.
- [ ] `.env.example`: `RTSP_CRED_KEY=` placeholder + comment cảnh báo đổi key.
- [ ] `.env` local: `RTSP_CRED_KEY=<dev ≥32>`.

**DoD**: boot không lỗi với key; Joi fail khi thiếu. **Ref**: NFR-003, EC-001.

## 4. Tests
**File**: `src/common/utils/secret-crypto.util.spec.ts` (mới) + iot-devices.service.spec (bổ sung)
- [ ] util: round-trip; 2 encrypt khác blob + decrypt đúng; sửa byte→throw; blob ngắn→throw; thiếu key→throw.
- [ ] configureRtsp: password → encrypted (no plaintext) + flag; không gửi → carry-over.
- [ ] coverage ≥80% code mới.

## 5. Verify
- [ ] build · lint per-file (npx eslint) · jest + coverage · boot smoke (key trong .env → started + 0 lỗi).

---

> Trạng thái: CHỜ REVIEW sau implement.
