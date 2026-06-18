---
name: feat-store-rtsp-credentials-plan
description: Kế hoạch hiện thực IOT-015 — util AES-256-GCM + configureRtsp lưu rtsp_password_encrypted + ENV RTSP_CRED_KEY.
category: iot
---

# Implementation Plan: Lưu credential RTSP mã hóa (IOT-015)

- **Feature ID**: IOT-015 · **Module**: iot (+ common util, config)
- **Spec**: [spec.md](./spec.md) · **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md IOT-015 (util secret-crypto, sửa configureRtsp, ENV RTSP_CRED_KEY). | Toàn bộ file |

---

## 1. Technical Context (đã xác minh)
- `configureRtsp` ([iot-devices.service.ts:~788-825](../../../../src/modules/iot/services/iot-devices.service.ts)): đọc `currentRtspConfig = (currentMetadata.rtsp_config as any) || {}`; build `newRtspConfig`; plaintext bị bỏ. → chèn encrypt + carry-over.
- DTO `rtsp_password?` đã có ([configure-rtsp.dto.ts:53-55](../../../../src/modules/iot/dto/configure-rtsp.dto.ts)) — **không sửa**.
- `maskSensitiveMetadata` che substring 'password' → `rtsp_password_encrypted` tự mask (không sửa).
- `logConfigureRtsp` đã `delete rtsp_password_encrypted` (L141) — không sửa.
- ENV Joi sectioned; `.env.example` sectioned A..I.
- `src/common` chưa có AES util → tạo mới.

## 2. Danh sách thay đổi (file)
| Loại | File |
|---|---|
| Mới | `src/common/utils/secret-crypto.util.ts` |
| Sửa | `src/modules/iot/services/iot-devices.service.ts` (configureRtsp) |
| Sửa | `src/config/env.validation.ts` (+ section Q + RTSP_CRED_KEY) |
| Sửa | `.env.example` (+ RTSP_CRED_KEY placeholder) |
| Sửa (local, KHÔNG commit) | `.env` (+ RTSP_CRED_KEY dev ≥32) |
| Mới (test) | `src/common/utils/secret-crypto.util.spec.ts` + bổ sung iot-devices.service.spec |

## 3. Util `secret-crypto.util.ts`
```ts
import * as crypto from 'crypto';
function deriveKey(): Buffer {
  const raw = process.env.RTSP_CRED_KEY;
  if (!raw) throw new Error('RTSP_CRED_KEY is not configured');
  return crypto.createHash('sha256').update(raw).digest(); // 32 byte (lazy)
}
export function encryptSecret(plain: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}
export function decryptSecret(blob: string): string {
  const key = deriveKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < 28) throw new Error('Invalid encrypted blob');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
```
- KHÔNG log plain/blob/key. Lazy key (đọc process.env mỗi call).

## 4. Sửa configureRtsp
```text
- import { encryptSecret } from '../../../common/utils/secret-crypto.util.js'
- passwordProvided = dto.rtsp_password != null && dto.rtsp_password !== ''
- newRtspConfig: bỏ chỉ-flag, thêm:
    if (passwordProvided) {
      newRtspConfig.rtsp_password_encrypted = encryptSecret(dto.rtsp_password)
      rtsp_password_configured = true
    } else {
      // carry-over từ currentRtspConfig
      if (currentRtspConfig.rtsp_password_encrypted)
        newRtspConfig.rtsp_password_encrypted = currentRtspConfig.rtsp_password_encrypted
      rtsp_password_configured = currentRtspConfig.rtsp_password_configured === true
    }
- KHÔNG gán plaintext. streamUrl giữ nguyên (không kèm cred). Audit/mask giữ nguyên.
```
- Chỉ thêm key trong object `newRtspConfig`; KHÔNG đổi entity/schema.

## 5. ENV
`env.validation.ts` thêm section:
```ts
// ─── Q. Recording Capture (IOT-015 / #23) ───
RTSP_CRED_KEY: Joi.string().min(32).required(),
```
`.env.example`: section "Q." + `RTSP_CRED_KEY=` (placeholder + comment "đổi key = mất khả năng giải mã password cũ").
`.env` local: `RTSP_CRED_KEY=<chuỗi dev ≥32>` (để boot/test; KHÔNG commit .env).

## 6. Tests (≥80% code mới)
- **secret-crypto.util.spec**: set `process.env.RTSP_CRED_KEY` trong beforeAll; round-trip; encrypt 2 lần → blob khác + cả 2 decrypt đúng; sửa 1 byte blob → throw; blob hỏng/ngắn → throw; thiếu key → deriveKey throw.
- **configureRtsp (iot-devices.service.spec bổ sung)**: rtsp_password → metadata.rtsp_config.rtsp_password_encrypted tồn tại (blob, KHÔNG plaintext) + configured=true; không gửi password (có encrypted cũ trong device.metadataJson) → carry-over; (mask/audit verify ở mức service nếu khả thi). Set RTSP_CRED_KEY env cho test.

## 7. Verify
build · lint per-file · jest + coverage · boot smoke (RTSP_CRED_KEY trong .env → started + 0 lỗi; thử bỏ key → confirm Joi fail rồi set lại).

## 8. [NEEDS CLARIFICATION]
- KHÔNG còn (NC-1..3 đã chốt). NC kế thừa: seed-runner/PermissionsGuard team-wide (không áp dụng vì IOT-015 không thêm permission/endpoint).

## 9. DoD
```
[ ] secret-crypto.util (AES-256-GCM, lazy key, blob iv‖tag‖ct, never log)
[ ] configureRtsp encrypt + carry-over, no plaintext
[ ] ENV RTSP_CRED_KEY (Joi min32 required) + .env.example + .env local
[ ] tests util + configureRtsp ≥80%
[ ] build/lint/test/boot xanh
```

> Trạng thái: CHỜ REVIEW. tasks.md đã tạo. Chưa commit.
