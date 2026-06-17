---
name: feat-facegate-client-plan
description: Kế hoạch FGC-001 — FaceDeviceProviderPort + FaceGateClient (add/del/find/upload/parse), HTTP Basic + AES creds, tz format, no-hang.
category: face-access
---

# Implementation Plan: FaceGate Device-Client Adapter (FGC-001)

- **Feature ID**: FGC-001 · **Module**: face-access (mới) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo plan.md FGC-001 (port + FaceGateClient, fetch+AbortController, fmt tz FACEGATE_TZ, parseWhitelistEntries cô lập E2, uploadFace isolate E3, env, unit test). | Toàn bộ file |

---

## 1. Technical Context (verified)
- AES creds: `decryptSecret` (IOT-015) cho `face_server_config.password_encrypted`.
- HTTP: KHÔNG axios → global `fetch` + `AbortController` (timeout, no-hang).
- iot_devices: `device_type='face_server'`, `ip_address`, `metadata_json.face_server_config`. Adapter NHẬN device/creds từ caller (B), KHÔNG tự query DB.
- Ẩn số: uploadFace (request thật) + parseWhitelistEntries (cấu trúc list) → cô lập, chốt khi smoke. DATA-01: KHÔNG migration.

## 2. Danh sách thay đổi (Ticket A)
| Loại | File |
|---|---|
| Mới | `face-access/face-access.module.ts` |
| Mới | `face-access/ports/face-device-provider.port.ts` (interface + types + FaceDeviceError) |
| Mới | `face-access/clients/facegate.client.ts` (FaceGateClient impl) |
| Mới | `face-access/utils/facegate-time.util.ts` (fmt tz FACEGATE_TZ) — hoặc trong client |
| Sửa | `config/env.validation.ts` (+FACEGATE_TIMEOUT_MS, +FACEGATE_TZ) + .env.example |
| Mới (test) | `face-access/clients/facegate.client.spec.ts` |

## 3. Port + Types
```text
ports/face-device-provider.port.ts:
- interface FaceDeviceProviderPort { uploadFace; addPerson; findUidByName; deletePerson; parseResponse }
- type FaceFileRef = { dwfiletype; dwfileindex; dwfilepos }
- type AddPersonInput = { uname; faceRef; validFrom: Date; validTo: Date; jurisdiction?: number[] }
- type FaceGateResponse = { errNo: number; root: Record<string, Record<string,string>> }
- class FaceDeviceError extends Error { kind; errNo?; httpStatus?; } (message sanitized)
- (token DI optional cho B: provide FaceDeviceProviderPort → FaceGateClient)
```

## 4. FaceGateClient
```text
constructor(deps: { baseUrl; username; password; timeoutMs; tz }) — B build từ device row (decrypt pass).
  HOẶC factory fromDevice(device, config) decrypt + dựng. (Chốt: client thuần, nhận sẵn creds.)

private request(path, query): Promise<FaceGateResponse>
  - url = baseUrl + path + '?' + encodeQuery(query) + '&nRanId=' + rand()
  - AbortController setTimeout(timeoutMs) → fetch(url, { headers: { Authorization: basic(user,pass) } })
  - HTTP != 200 → FaceDeviceError(http_error, status)
  - text → parseResponse
  - abort → FaceDeviceError(timeout)
  - KHÔNG log url/Authorization/creds (mask).

addPerson(input): dựng query (uid=-1, dwfile* từ faceRef, uname encode, uvalid* = fmtTz(validFrom/To),
  CFGIpcJurisdiction.bIPC_Enable* theo jurisdiction|all, hằng số ulisttype/ucardtype/uStatus...)
  → request(setWhitelist) → errNo===0 ? {ok} : FaceDeviceError(device_error,errNo).
deletePerson(uid): request(setWhitelist?action=del&LIST.uid) → ok/err.
findUidByName(uname): loop beginno (reqcount=R), request(getWhitelist?action=list)
  → parseWhitelistEntries(resp) → tìm uname → uid; hết trang → dừng; không thấy → null.
parseWhitelistEntries(resp): trích [{uname,uid}] từ root.* (E2 ẩn số) — robust: lạ → [].
uploadFace(image): NÉM FaceDeviceError(not_implemented) cho tới khi reverse-engineer (E3).
parseResponse(text): split dòng `root.<NS>.<field>=value` → map + errNo (pure).
fmtTz(date, tz): 'YYYY-MM-DD HH:mm:ss' theo tz (Intl.DateTimeFormat timeZone) — E1.
```

## 5. Time format (E1)
```text
fmtTz dùng Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12:false, ... }) → ghép 'YYYY-MM-DD HH:mm:ss'.
Default tz = FACEGATE_TZ (Asia/Ho_Chi_Minh). validFrom (UTC instant) → giờ tz đó.
Suy uvalidDateBeg/End (phần ngày) + uvalidTimeBeg/End (phần giờ) từ cùng kết quả.
```

## 6. ENV
Joi: `FACEGATE_TIMEOUT_MS: Joi.number().integer().min(1000).max(30000).default(8000)`,
`FACEGATE_TZ: Joi.string().default('Asia/Ho_Chi_Minh')`. .env.example.

## 7. Tests (mock global fetch, ≥80%)
- parseResponse ok/err/missing/rác.
- addPerson: assert URL (action=add, uname encode, uvalidbegin/endtime fmt tz, CFGIpcJurisdiction); errNo 0→ok / ≠0→device_error.
- E1: validFrom UTC + tz UTC+7 → uvalidbegintime '....08:00:00'.
- deletePerson URL + ok/err.
- findUidByName: nhiều entry match/không; phân trang dừng.
- E2 robust: list format lạ → parseWhitelistEntries [] → null (không crash).
- auth: Authorization Basic đúng; spy logger KHÔNG lộ creds.
- timeout: fetch không resolve → abort → FaceDeviceError(timeout).
- uploadFace → not_implemented.
(mock fetch: jest.spyOn(global,'fetch') trả {ok,status,text}; timeout: fetch trả promise không settle + jest fake timers / AbortController.)

## 8. [NEEDS CLARIFICATION]
- NC-4 uploadFace + NC-5 parseWhitelistEntries: ẩn số → reverse-engineer khi smoke (DoD E3). NC-1 fetch (chốt). NC-2 jurisdiction all. NC-6 tz FACEGATE_TZ.

## 9. DoD (E3 — A chỉ done khi)
```
[ ] Unit ≥80% (mock fetch) — gồm tz E1 + robust list E2 + not_implemented.
[ ] uploadFace reverse-engineer xong (bỏ not_implemented).
[ ] parseWhitelistEntries chốt theo response thật.
[ ] Smoke e2e cam thật PASS: upload→add(validity)→find(uid)→delete→list sạch.
[ ] build/lint/jest xanh; creds mã hoá/không log; FACEGATE_TZ/TIMEOUT qua env; KHÔNG migration.
```

> Trạng thái: CHỜ REVIEW. Chưa code.
