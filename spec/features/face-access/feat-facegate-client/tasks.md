# Tasks: FaceGate Device-Client Adapter (FGC-001)

- **Feature ID**: FGC-001 · **Module**: face-access (Ticket A)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> Adapter-only: port + FaceGateClient (add/del/find/upload/parse). HTTP Basic + AES creds, fetch+AbortController, fmt tz FACEGATE_TZ. uploadFace + parseWhitelistEntries = ẩn số cô lập (chốt khi smoke). KHÔNG scheduler/attendance/mapping (B/C/D). KHÔNG migration.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo tasks.md FGC-001 (port, client, tz util, env, unit test, DoD E3). | Toàn bộ file |

---

## 1. Port + Types
**File**: `face-access/ports/face-device-provider.port.ts` (mới)
- [ ] interface `FaceDeviceProviderPort` (uploadFace/addPerson/findUidByName/deletePerson/parseResponse).
- [ ] types FaceFileRef, AddPersonInput, FaceGateResponse; class FaceDeviceError (kind/errNo/httpStatus, message sanitized). **Ref**: FR-001/006.

## 2. FaceGateClient
**File**: `face-access/clients/facegate.client.ts` (mới)
- [ ] private request(): fetch + AbortController(timeout) + Authorization Basic + nRanId; HTTP≠200→http_error; abort→timeout; KHÔNG log creds. **Ref**: FR-007/008/009, NFR-001/003.
- [ ] addPerson: dựng URL (uid=-1, dwfile*, uname encode, uvalid* fmt tz, CFGIpcJurisdiction); errNo→ok/device_error. **Ref**: FR-002.
- [ ] deletePerson(uid). **Ref**: FR-003.
- [ ] findUidByName: phân trang + parseWhitelistEntries (E2 robust → []). **Ref**: FR-004.
- [ ] parseResponse: root.<NS>.<field>=value → map + errNo (pure). **Ref**: FR-006.
- [ ] uploadFace → FaceDeviceError(not_implemented) (tạm — E3). **Ref**: FR-005.

## 3. Time util (E1)
**File**: `face-access/utils/facegate-time.util.ts` (hoặc trong client)
- [ ] fmtTz(date, tz): 'YYYY-MM-DD HH:mm:ss' theo tz (Intl), default FACEGATE_TZ; suy uvalidDate/Time sub-fields. **Ref**: NFR-002, AC-011.

## 4. Module + ENV
- [ ] `face-access.module.ts`: provide FaceDeviceProviderPort → FaceGateClient (export cho B).
- [ ] env.validation +FACEGATE_TIMEOUT_MS (default 8000) +FACEGATE_TZ (default Asia/Ho_Chi_Minh); .env.example.

## 5. Tests (mock global fetch, ≥80%)
**File**: `face-access/clients/facegate.client.spec.ts` (mới)
- [ ] parseResponse ok/err/rác; addPerson URL+errNo; **E1 tz** (UTC→+7 = 08:00:00); deletePerson; findUidByName match/null/phân trang; **E2 robust** list lạ→null; auth-mask; timeout; uploadFace not_implemented.

## 6. Verify (gate) + DoD E3
- [ ] build · lint per-file · jest face-access + coverage. STOP review-gate.
- [ ] (Khi build thật) reverse-engineer uploadFace + parseWhitelistEntries + smoke e2e cam thật PASS → A mới DONE.

---
> Trạng thái: CHỜ REVIEW. Chưa code.
