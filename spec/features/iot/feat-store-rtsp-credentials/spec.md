---
name: feat-store-rtsp-credentials
description: Lưu mật khẩu RTSP camera dạng mã hóa (AES-256-GCM) trong metadata_json.rtsp_config, phục vụ ffmpeg capture (#23b). Không lộ plaintext.
category: iot
---

# Feature Specification: Lưu credential RTSP mã hóa (Store RTSP Credentials)

- **Feature ID**: IOT-015 (phase #23a — hạ tầng cho start recording)
- **Feature Name**: Lưu mật khẩu RTSP camera dạng mã hóa
- **Module / Domain**: iot (+ common util)
- **Created Date**: 2026-06-15
- **Status**: Draft (đã chốt clarifications)
- **Source Documents**:
  - `CLAUDE.md` (SEC-01 không log/persist secret; 11.x camera/RTSP; DATA-01)
  - `spec/global/constitution.md` (SEC-01/03, DATA-01)
  - `spec/features/iot/feat-configure-ip-camera-rtsp` (IOT-005 — configureRtsp)
  - `src/modules/iot/services/iot-devices.service.ts` (configureRtsp ~L795-825)
  - `src/common/utils/masking.util.ts` (maskSensitiveMetadata)
  - `src/modules/iot/repositories/iot-audit.repository.ts` (logConfigureRtsp strip ~L139-141)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo spec IOT-015: util AES-256-GCM `secret-crypto.util`, configureRtsp lưu `rtsp_password_encrypted`, ENV `RTSP_CRED_KEY`. Tái dùng endpoint configure-rtsp (UC-69). | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-1 (key=sha256(RTSP_CRED_KEY)), NC-2 (v1 không clear password), NC-3 (blob base64(iv[12]‖tag[16]‖ct)). Thêm lưu ý: derive key **lazy tại call-time**; configureRtsp **carry-over** rtsp_password_encrypted cũ khi không gửi password. Mục 11 → đã chốt. | Mục 3, 4, 11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Hiện tại khi cấu hình RTSP (IOT-005 `configureRtsp`), mật khẩu camera (`dto.rtsp_password`) **bị vứt bỏ** — chỉ lưu cờ `rtsp_password_configured` ([service.ts:801-807](../../../../src/modules/iot/services/iot-devices.service.ts)). Comment trong code ghi rõ: *"never persist the RTSP password (no encryption util exists in the codebase)"*. Hệ quả: khi sang #23b (ffmpeg capture từ camera có auth), backend **không có mật khẩu** để dựng URL `rtsp://user:pass@host`.

`iot_devices` **không có cột password**; `src/common` **chưa có util AES** (chỉ có `crypto.createHash` one-way). IOT-015 (phase #23a) bổ sung **util mã hóa đối xứng AES-256-GCM** và cho `configureRtsp` lưu mật khẩu **đã mã hóa** vào `metadata_json.rtsp_config.rtsp_password_encrypted`, sẵn sàng cho #23b giải mã nội bộ.

### 1.2 Mục tiêu

- Thêm util `secret-crypto.util.ts`: `encryptSecret(plain) → blob`, `decryptSecret(blob) → plain` (AES-256-GCM, IV ngẫu nhiên/lần).
- Sửa `configureRtsp`: khi `dto.rtsp_password` có giá trị → encrypt → lưu `rtsp_password_encrypted` + `rtsp_password_configured=true`. **KHÔNG lưu plaintext.**
- Đảm bảo `rtsp_password_encrypted` **không bao giờ** lộ ra response/log/audit.
- `decryptSecret` chỉ dùng nội bộ (cho #23b), **không** có endpoint trả password.

### 1.3 Giá trị mang lại

- Mở khóa #23b (ffmpeg capture camera có mật khẩu) mà vẫn tuân SEC-01.
- Cung cấp util mã hóa tái dùng cho các secret khác sau này.

### 1.4 Out-of-scope

- Ghi hình/ffmpeg thật (#23b), tạo `recording_session`.
- Endpoint MỚI (tái dùng `PUT /api/v1/iot-devices/:id/rtsp-config` — UC-69/IOT-005).
- GET/trả mật khẩu giải mã ra API — **KHÔNG bao giờ**.
- Key rotation / re-encrypt hàng loạt khi đổi `RTSP_CRED_KEY`.
- Xóa password (clear) — xem [NC-2].
- Đổi schema/migration (chỉ ghi vào `metadata_json` jsonb có sẵn) — DATA-01.

---

## 2. System Context (kết quả RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| configureRtsp password | [iot-devices.service.ts:801-807](../../../../src/modules/iot/services/iot-devices.service.ts): chỉ tính `passwordProvided` + `rtsp_password_configured`; **plaintext bị bỏ**. `newRtspConfig` = `{ rtsp_enabled, rtsp_protocol, rtsp_host, rtsp_port, rtsp_path, rtsp_username, stream_profile, rtsp_password_configured, configured_at }`, lưu tại `metadata_json.rtsp_config`. |
| DTO | [configure-rtsp.dto.ts:53-55](../../../../src/modules/iot/dto/configure-rtsp.dto.ts): `@IsOptional @IsString rtsp_password?: string` — đã có, **không cần đổi DTO**. |
| Mask | [masking.util.ts](../../../../src/common/utils/masking.util.ts): che **mọi key chứa substring** `secret`/`token`/`password` (đệ quy). ⇒ `rtsp_password_encrypted` chứa "password" → **ĐÃ tự động bị mask** (D3 thỏa sẵn, KHÔNG cần sửa). |
| Audit | [iot-audit.repository.ts:139-141](../../../../src/modules/iot/repositories/iot-audit.repository.ts): `logConfigureRtsp` đã `delete safeMetadata.rtsp_password` **và** `delete safeMetadata.rtsp_password_encrypted` ⇒ D6 thỏa sẵn (verify lại sau khi lưu field này). |
| AES util | `src/common` **CHƯA có** (grep `createCipheriv` rỗng). → tạo mới `secret-crypto.util.ts`. |
| ENV | [env.validation.ts](../../../../src/config/env.validation.ts) Joi sectioned; mới nhất "K2. Device Probe". [.env.example](../../../../.env.example) sectioned A..I. → thêm section "Q. Recording Capture" + `RTSP_CRED_KEY`. |
| Service đọc config | `IotDevicesService` chưa inject `ConfigService` → cần inject để đọc `RTSP_CRED_KEY` (hoặc util tự đọc `process.env` — xem plan). |

### 2.1 Actor & Roles
Tái dùng IOT-005: người có `iot.device.configure` gọi `rtsp-config`. IOT-015 không thêm permission/endpoint.

### 2.2 Entity liên quan
`iot_devices.metadata_json` (jsonb) — chỉ thêm key `rtsp_password_encrypted` trong `rtsp_config`. KHÔNG cột/bảng mới.

---

## 3. Util `secret-crypto.util.ts` (thiết kế)

```text
- KEY = crypto.createHash('sha256').update(RTSP_CRED_KEY).digest()  // 32 byte
- encryptSecret(plain: string): string
    iv = crypto.randomBytes(12)                       // GCM nonce 96-bit, ngẫu nhiên mỗi lần
    cipher = createCipheriv('aes-256-gcm', KEY, iv)
    ct = cipher.update(plain,'utf8') ‖ cipher.final()
    tag = cipher.getAuthTag()                          // 16 byte
    return base64( iv ‖ tag ‖ ct )                     // blob
- decryptSecret(blob: string): string
    buf = base64decode(blob); iv=buf[0:12]; tag=buf[12:28]; ct=buf[28:]
    decipher = createDecipheriv('aes-256-gcm', KEY, iv); setAuthTag(tag)
    return decipher.update(ct) ‖ decipher.final()      // ném nếu tag sai (toàn vẹn)
```
- Node core `crypto`, KHÔNG lib ngoài. KHÔNG log plain/blob/key.
- **Lazy key derivation**: KEY tính **tại call-time** bên trong `encryptSecret`/`decryptSecret` (đọc `process.env.RTSP_CRED_KEY` mỗi lần) — KHÔNG cache ở module-load (tránh phụ thuộc thứ tự load ENV/test).

---

## 4. Luồng configureRtsp (sửa)

```text
1. (như IOT-005) validate device là ip_camera/room_camera + đã gán phòng.
2. passwordProvided = dto.rtsp_password != null && != ''.
3. IF passwordProvided:
     encrypted = encryptSecret(dto.rtsp_password)
     newRtspConfig.rtsp_password_encrypted = encrypted
     newRtspConfig.rtsp_password_configured = true
   ELSE (không gửi password):
     giữ nguyên rtsp_password_encrypted cũ (nếu có) + rtsp_password_configured cũ.  // không đổi password
4. KHÔNG bao giờ gán plaintext vào metadata. device.streamUrl vẫn KHÔNG kèm credential.
5. save device; audit logConfigureRtsp (đã strip rtsp_password_encrypted).
6. Response qua toIotDeviceResponse → metadata_json đã mask (rtsp_password_encrypted='***').
```

---

## 5. Functional Requirements (EARS)

```text
FR-IOT-015-001: THE system SHALL cung cấp util encryptSecret/decryptSecret dùng AES-256-GCM với key = sha256(RTSP_CRED_KEY) (32 byte) và IV ngẫu nhiên 12 byte mỗi lần mã hóa.
FR-IOT-015-002: THE system SHALL biểu diễn blob mã hóa dạng base64(iv ‖ authTag ‖ ciphertext).
FR-IOT-015-003: WHEN configureRtsp nhận rtsp_password khác rỗng, THE system SHALL lưu metadata_json.rtsp_config.rtsp_password_encrypted = encryptSecret(password) và rtsp_password_configured = true; SHALL NOT lưu plaintext.
FR-IOT-015-004: WHEN configureRtsp KHÔNG nhận rtsp_password, THE system SHALL giữ nguyên rtsp_password_encrypted và rtsp_password_configured hiện có (không đổi password).
FR-IOT-015-005: THE system SHALL đảm bảo rtsp_password_encrypted KHÔNG xuất hiện trong response (mask) và KHÔNG ghi vào audit_logs (đã strip).
FR-IOT-015-006: decryptSecret SHALL chỉ được gọi nội bộ (server-side); THE system SHALL NOT cung cấp endpoint trả mật khẩu giải mã.
FR-IOT-015-007: WHEN giải mã với authTag/key sai, THE system SHALL ném lỗi (AES-GCM authenticated) thay vì trả dữ liệu sai.
```

## 6. Non-functional Requirements (EARS)

```text
NFR-IOT-015-001 (SEC-01): THE system SHALL NOT log/persist plaintext mật khẩu RTSP dưới bất kỳ hình thức nào (console/file/db/audit).
NFR-IOT-015-002 (Security): Mã hóa SHALL là authenticated (AES-256-GCM) + IV ngẫu nhiên/lần ⇒ cùng plaintext cho ra blob khác nhau, chống tamper.
NFR-IOT-015-003 (Config): RTSP_CRED_KEY SHALL bắt buộc (Joi min 32, required); thiếu → app fail-fast lúc boot.
NFR-IOT-015-004 (Persistence): Chỉ ghi vào metadata_json jsonb có sẵn; KHÔNG migration/đổi schema (DATA-01). Dùng node crypto, KHÔNG lib ngoài.
NFR-IOT-015-005 (Reuse): util đặt ở src/common/utils để tái dùng cho secret khác.
```

## 7. Acceptance Criteria

```text
AC-IOT-015-001: Given RTSP_CRED_KEY set; When encryptSecret('p@ss') rồi decryptSecret(blob); Then ra lại 'p@ss'.
AC-IOT-015-002: Given cùng plaintext; When encrypt 2 lần; Then 2 blob KHÁC nhau (IV ngẫu nhiên), cả 2 decrypt đúng.
AC-IOT-015-003: Given blob bị sửa 1 byte; When decryptSecret; Then ném lỗi (authTag fail).
AC-IOT-015-004: Given configureRtsp với rtsp_password='secret'; When lưu; Then metadata_json.rtsp_config có rtsp_password_encrypted (blob) + rtsp_password_configured=true, KHÔNG có plaintext; response trả '***' cho field encrypted.
AC-IOT-015-005: Given device đã có rtsp_password_encrypted; When configureRtsp KHÔNG gửi rtsp_password; Then giữ nguyên encrypted cũ.
AC-IOT-015-006: Given configureRtsp; When ghi audit_logs; Then KHÔNG có rtsp_password lẫn rtsp_password_encrypted.
```

## 8. Edge / Error Cases (EARS)

```text
EC-IOT-015-001: IF RTSP_CRED_KEY thiếu/ngắn < 32, THEN app fail boot (Joi).
EC-IOT-015-002: IF blob base64 hỏng/độ dài < 28 byte sau decode, THEN decryptSecret ném lỗi (không trả rỗng âm thầm).
EC-IOT-015-003: IF rtsp_password = '' (rỗng), THEN coi như không gửi (không encrypt, không đổi) — xem [NC-2].
```

## 9. Traceability

| Requirement | Nguồn |
|---|---|
| FR-001/002/007 | D1 (AES-GCM, blob, authenticated) |
| FR-003/004 | D2 (configureRtsp lưu encrypted) |
| FR-005 | D3 mask (thỏa sẵn) + D6 audit strip |
| FR-006 | D4 (decrypt nội bộ) |
| NFR-001/002 | SEC-01 |
| NFR-003 | D5 (ENV) |

## 10. Quyết định đã chốt (Resolved Clarifications)

| # | Quyết định |
|---|---|
| D-1 | Util mới `src/common/utils/secret-crypto.util.ts` AES-256-GCM; key=sha256(RTSP_CRED_KEY); IV randomBytes(12)/lần; blob=base64(iv‖tag‖ct); node crypto; không log plaintext. |
| D-2 | configureRtsp: rtsp_password có → encrypt → lưu `rtsp_password_encrypted` + `configured=true`; không gửi → giữ nguyên cũ; không lưu plaintext. |
| D-3 | mask `rtsp_password_encrypted` — **đã thỏa sẵn** (maskSensitiveMetadata che substring 'password'). KHÔNG cần sửa masking.util. |
| D-4 | decryptSecret chỉ nội bộ (#23b dựng URL ffmpeg); KHÔNG endpoint trả password. |
| D-5 | ENV `RTSP_CRED_KEY` Joi.string().min(32).required() (section "Q. Recording Capture"); thêm vào .env.example (placeholder) + .env local (dev, không commit). |
| D-6 | Audit `logConfigureRtsp` đã `delete rtsp_password_encrypted` (L141) — giữ nguyên, verify lại. |

## 11. Quyết định bổ sung đã chốt (vòng 2)

| # | Quyết định |
|---|---|
| **NC-1 → chốt** | Key = **`sha256(RTSP_CRED_KEY)`** → 32 byte (không scrypt/salt). Derive **lazy tại call-time**. |
| **NC-2 → chốt** | v1 **KHÔNG** hỗ trợ clear password — gửi rỗng/null = **không đổi** (carry-over encrypted cũ). Cơ chế clear defer. |
| **NC-3 → chốt** | Blob = **`base64(iv[12] ‖ authTag[16] ‖ ciphertext)`** (đúng thứ tự/độ dài). |

---

> Trạng thái: **CHỜ REVIEW**. Chỉ là spec — chưa plan/tasks/code. Dừng chờ Thiếu Chủ.
