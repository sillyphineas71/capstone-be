---
name: feat-facegate-client
description: FaceGate device-client adapter (FaceDeviceProviderPort) — add/delete/find person + uploadFace + parse root.ERR. Ticket A, module face-access. Vendor-agnostic.
category: face-access
---

# Feature Specification: FaceGate Device-Client Adapter

- **Feature ID**: FGC-001 (Face-access Pha 1 · Ticket A)
- **Feature Name**: FaceGate device-client adapter (FaceDeviceProviderPort + FaceGateClient)
- **Module / Domain**: face-access (mới)
- **Created Date**: 2026-06-17
- **Status**: Draft (RECON xong)
- **Source Documents**:
  - `spec/global/constitution.md` (SEC-01 secret; SEC-03 input; ARCH-02 inline/no-hang; ARCH-01 boundary)
  - `CLAUDE.md` (§11.2 Face Server; §11.3 adapter/port; §11.9 device callback security; §11.12 không làm face model backend)
  - Device API (reverse-engineer, FaceGate `webs/` CGI, HTTP Basic): `setWhitelist?action=add/del`, `getWhitelist?action=list`, response `root.<NS>.<field>=value`, `root.ERR.no=0`=ok
  - `src/common/utils/secret-crypto.util.ts` (IOT-015 — encryptSecret/decryptSecret)
  - `src/modules/iot/entities/iot-device.entity.ts` (device_type='face_server', ipAddress, metadata_json.face_server_config)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo spec FGC-001 (Ticket A): FaceDeviceProviderPort + FaceGateClient (addPerson/deletePerson/findUidByName/uploadFace/parseResponse), HTTP Basic + AES creds, parse root.ERR, timeout no-hang, cô lập uploadFace (ẩn số). Scheduler/provisioning/attendance/mapping = B/C/D (ngoài scope). | Toàn bộ file (bản đầu) |
| 2026-06-17 | Review chỉnh E1/E2/E3: (E1) fmt(date) theo **tz thiết bị** (`FACEGATE_TZ`, default Asia/Ho_Chi_Minh), KHÔNG UTC/tz-server ngầm; (E2) response `getWhitelist list` là **ẩn số** → cô lập parse list, chốt khi smoke + robust fallback null; (E3) DoD: A chỉ DONE khi uploadFace reverse-engineer xong + smoke e2e PASS trên cam thật (`not_implemented` chỉ tạm cho unit). | §4.1, §4.3, §8, §9, §10, §11 |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
Pha 1 face-access cần đẩy/gỡ khuôn mặt participant lên Door Face Terminal (FaceGate) theo cuộc họp. **Ticket A** chỉ làm **lớp giao tiếp thiết bị** (device-client adapter) — đóng gói các lời gọi HTTP `webs/` của FaceGate sau một **port vendor-agnostic** (§11.3) để B/C/D dùng mà không phụ thuộc vendor. Backend **KHÔNG** nhận diện khuôn mặt (§11.2/§11.12) — chỉ ra lệnh add/del/upload.

### 1.2 Mục tiêu
- `FaceDeviceProviderPort` (interface trừu tượng) — hợp đồng vendor-agnostic.
- `FaceGateClient implements FaceDeviceProviderPort` — impl cho FaceGate `webs/` CGI.
- 5 method: `addPerson`, `deletePerson`, `findUidByName`, `uploadFace`, `parseResponse`.
- Auth HTTP Basic (creds AES-decrypt từ `iot_devices.metadata_json.face_server_config`), không log creds.
- Timeout mỗi call (no-hang); retry để caller (B) lo.

### 1.3 Giá trị mang lại
- B/C/D gọi 1 API ổn định; đổi vendor/firmware chỉ sửa impl, không phá domain (§11.3).
- Cô lập **ẩn số uploadFace** vào đúng 1 hàm.

### 1.4 Out-of-scope (B/C/D)
- Scheduler/cron provisioning (push lúc bắt đầu / gỡ lúc kết thúc) = **Ticket B**.
- Sync-tracking `device_user_mappings` + reconcile = **Ticket B**.
- Runtime resolve→authorize→attendance = **Ticket C**.
- Portrait storage / face_profiles / media_files = **Ticket D**.
- Quyết định "ai mở cửa" (NC-1 recon) — không thuộc adapter.
- KHÔNG đổi schema/migration.

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| AES creds | [secret-crypto.util.ts:24,36](../../../../src/common/utils/secret-crypto.util.ts): `encryptSecret`/`decryptSecret` (AES-256-GCM, key=sha256(RTSP_CRED_KEY) — IOT-015). ⇒ creds FaceGate lưu **mã hoá** trong `face_server_config`, decrypt tại runtime. |
| iot_devices | [iot-device.entity.ts:17,52](../../../../src/modules/iot/entities/iot-device.entity.ts): `device_type='face_server'`, `ip_address`?, `room_id`?, `metadata_json.face_server_config`. ⇒ base URL + creds resolve từ row này. |
| HTTP client | Repo **KHÔNG** dùng axios/HttpModule (chỉ `net`/probeTcp ở IOT-014). ⇒ dùng **global `fetch` (Node LTS ≥18) + AbortController** cho timeout (không thêm dependency). |
| FaceGate API | `webs/setWhitelist?action=add` (LIST.uid=-1, dwfiletype/dwfileindex/dwfilepos, LIST.uname, LIST.uvalidbegintime/uvalidendtime, CFGIpcJurisdiction.bIPC_Enable0..N), `?action=del&LIST.uid=<uid>`, `getWhitelist?action=list&beginno&reqcount`, `nRanId=<random>` mỗi request. Response **text**: dòng `root.<NS>.<field>=value`; `root.ERR.no=0`=ok. `add` **KHÔNG trả uid** → phải `getWhitelist` lọc theo `uname`. |

---

## 3. FaceDeviceProviderPort (vendor-agnostic)

```text
interface FaceDeviceProviderPort {
  uploadFace(image: Buffer): Promise<FaceFileRef>;                 // ẩn số — xem §6
  addPerson(input: AddPersonInput): Promise<{ ok: true }>;        // ok khi ERR.no=0
  findUidByName(uname: string): Promise<string | null>;          // uid (vì add không trả)
  deletePerson(uid: string): Promise<{ ok: true }>;
  parseResponse(text: string): FaceGateResponse;                 // parse root.<NS>.<field>
}

type FaceFileRef = { dwfiletype: number; dwfileindex: number; dwfilepos: number };
type AddPersonInput = {
  uname: string;                 // khoá định danh của mình (vd userId / userId:bookingId)
  faceRef: FaceFileRef;          // kết quả uploadFace
  validFrom: Date;               // = giờ bắt đầu họp (B truyền)
  validTo: Date;                 // = giờ kết thúc họp
  jurisdiction?: number[];       // danh sách door/IPC enable (mặc định tất cả) — [NC-2]
};
type FaceGateResponse = { errNo: number; root: Record<string, Record<string, string>> };
```

- Port đặt ở `face-access` (B/C/D inject port, KHÔNG inject FaceGateClient trực tiếp).

---

## 4. Methods (FaceGateClient)

### 4.1 addPerson
```text
GET webs/setWhitelist?action=add&group=LIST
  &LIST.uid=-1
  &LIST.dwfiletype=<faceRef.dwfiletype>&LIST.dwfileindex=<...>&LIST.dwfilepos=<...>
  &LIST.uname=<encodeURIComponent(uname)>
  &LIST.uvalidbegintime=<fmt(validFrom)>&LIST.uvalidendtime=<fmt(validTo)>
  &LIST.uvalidDateBeg/End, uvalidTimeBeg/End  (suy từ validFrom/To)
  &CFGIpcJurisdiction.bIPC_Enable0..N=1   (theo jurisdiction; mặc định all=1)
  &LIST.ulisttype=0&LIST.ucardtype=0&LIST.uStatus=4&... (hằng số đã quan sát)
  &nRanId=<random>
→ parseResponse; ok khi errNo===0; else FaceDeviceError(device_error, errNo).
fmt(date) = 'YYYY-MM-DD HH:mm:ss' theo **tz THIẾT BỊ** (E1): config `FACEGATE_TZ`
  (default `Asia/Ho_Chi_Minh`); chuyển validFrom/To (UTC instant) sang giờ tz đó —
  KHÔNG dùng UTC hay tz-server ngầm. Set ĐỦ cả validity sub-fields:
  uvalidbegintime/uvalidendtime + uvalidDateBeg/End + uvalidTimeBeg/End (suy từ cùng tz).
  SEC-03: format chặt, không nội suy chuỗi tự do.
```

### 4.2 deletePerson
```text
GET webs/setWhitelist?action=del&group=LIST&LIST.uid=<uid>&nRanId=<random>
→ ok khi errNo===0; uid không tồn tại → coi như đã xoá (idempotent ở caller B) / errNo map.
```

### 4.3 findUidByName
```text
Lặp trang: getWhitelist?action=list&group=LIST&beginno=<n>&reqcount=<R>&...&RanId=<random>
  parse → duyệt các bản ghi root.LIST*/root.LISTi.uname; match uname → trả uid.
  Hết trang (số bản ghi < reqcount hoặc đủ count) → dừng.
Không thấy → null. Nhiều match (trùng uname) → trả cái mới nhất / đầu tiên ([NC-3]).
(Dùng sau addPerson để lấy uid lưu vào device_person_id — ở Ticket B.)

⚠️ E2 — ẨN SỐ: cấu trúc CHÍNH XÁC của response list (cách đánh số bản ghi:
  root.LIST.uid vs root.LIST0/LIST1.uid vs root.LISTi.<field>, field tên uname/uid) CHƯA
  được xác nhận trên cam thật. ⇒ CÔ LẬP phần "parse danh sách → trích (uname,uid)" vào
  một sub-hàm riêng (vd parseWhitelistEntries) để chốt khi smoke. Robust: nếu format chỉ số
  khác kỳ vọng / không tách được entry → trả [] (⇒ findUidByName=null), KHÔNG crash.
```

### 4.4 uploadFace — ⚠️ ẨN SỐ (cô lập 1 chỗ)
```text
uploadFace(image: Buffer): Promise<FaceFileRef>
- Request upload CHƯA reverse-engineer (POST multipart? /webs/setUploadFile? chunked + getUploadPercent poll?).
- Ticket A: ĐỊNH NGHĨA chữ ký + cô lập toàn bộ logic upload trong DUY NHẤT hàm này.
  Mọi method khác (add/del/find/parse) KHÔNG phụ thuộc chi tiết upload → ổn định.
- Hành vi dự kiến (chốt khi smoke cam thật): POST ảnh → (poll getUploadPercent tới 100%) → nhận
  dwfiletype/dwfileindex/dwfilepos → trả FaceFileRef.
- Cho tới khi reverse-engineer xong: hàm ném `FaceDeviceError(not_implemented)` rõ ràng (B chưa gọi).
```

### 4.5 parseResponse
```text
parseResponse(text): FaceGateResponse
- Tách từng dòng dạng `root.<NS>.<field>=<value>` → gom vào root[NS][field].
- errNo = Number(root.ERR.no) (mặc định NaN→ -1 nếu thiếu).
- KHÔNG ném ở đây (pure); caller quyết theo errNo.
- Dòng không khớp pattern → bỏ qua an toàn.
```

---

## 5. Auth + Config resolve

```text
- Base URL: `http://<device.ip_address>` (FaceGate LAN; cổng mặc định 80) — từ row iot_devices.
- Creds: device.metadata_json.face_server_config = { username, password_encrypted, ... }.
  password = decryptSecret(password_encrypted)  (AES IOT-015).
- HTTP Basic: header Authorization = 'Basic ' + base64(username:password).
- nRanId/RanId: số random mỗi request (chống cache, không phải bảo mật).
- Client nhận device row (hoặc {baseUrl, username, passwordEncrypted}) khi khởi tạo/ gọi.
  ⇒ FaceGateClient KHÔNG tự query DB (B truyền device vào) — giữ adapter thuần.
```

---

## 6. Error model + Resilience

```text
FaceDeviceError { kind: 'device_error'|'http_error'|'timeout'|'parse_error'|'not_implemented';
                  errNo?: number; httpStatus?: number; message: string }
- device_error: errNo !== 0.
- http_error: HTTP status !== 200.
- timeout: vượt FACEGATE_TIMEOUT_MS (5–10s, AbortController) — KHÔNG treo (ARCH-02).
- parse_error / not_implemented (uploadFace).
- message ĐÃ sanitize (KHÔNG chứa creds/Authorization/url-có-token).
- KHÔNG retry trong adapter — caller B lo retry/backoff + reconcile.
```

---

## 7. Functional Requirements (EARS)

```text
FR-FGC-001-001: THE system SHALL cung cấp FaceDeviceProviderPort (interface) + FaceGateClient impl.
FR-FGC-001-002: addPerson SHALL dựng setWhitelist?action=add (uid=-1, dwfile*, uname encode, uvalidbegin/endtime=validFrom/To, CFGIpcJurisdiction.* theo jurisdiction); ok khi root.ERR.no===0; else FaceDeviceError(device_error,errNo).
FR-FGC-001-003: deletePerson SHALL gọi setWhitelist?action=del&LIST.uid=<uid>; ok khi errNo===0.
FR-FGC-001-004: findUidByName SHALL getWhitelist?action=list phân trang (beginno/reqcount), match uname → uid; không thấy → null.
FR-FGC-001-005: uploadFace SHALL là điểm CÔ LẬP duy nhất phụ thuộc request upload thật; chưa reverse-engineer → ném FaceDeviceError(not_implemented).
FR-FGC-001-006: parseResponse SHALL parse các dòng root.<NS>.<field>=value thành map + errNo; pure (không ném).
FR-FGC-001-007: THE client SHALL auth HTTP Basic với creds decryptSecret từ face_server_config; mỗi request có nRanId random.
FR-FGC-001-008: Mọi call SHALL có timeout (FACEGATE_TIMEOUT_MS) + KHÔNG treo; map timeout→FaceDeviceError(timeout).
FR-FGC-001-009: THE client SHALL NOT log creds/Authorization header (mask).
```

## 8. Non-functional (Constitution)

```text
NFR-FGC-001-001 (SEC-01): Creds KHÔNG plaintext — lưu mã hoá (AES IOT-015), decrypt in-memory; KHÔNG log creds/Authorization/url-có-cred.
NFR-FGC-001-002 (SEC-03 + E1 tz): uname encodeURIComponent; validFrom/To format 'YYYY-MM-DD HH:mm:ss' theo **tz thiết bị** (`FACEGATE_TZ`, default Asia/Ho_Chi_Minh) — KHÔNG UTC/tz-server ngầm; set đủ uvalidDate/Time sub-fields cùng tz; uid an toàn trước khi nối URL.
NFR-FGC-001-003 (ARCH-02/no-hang): timeout cứng 5–10s; AbortController; KHÔNG retry (caller lo).
NFR-FGC-001-004 (ARCH-01/§11.3): FaceGateClient sau port; B/C/D phụ thuộc port, KHÔNG phụ thuộc vendor.
NFR-FGC-001-005 (DATA-01): KHÔNG migration; chỉ ĐỌC iot_devices.
NFR-FGC-001-006 (Rủi ro): FaceGate dùng **HTTP thường trong LAN** (không TLS) → creds Basic + payload đi clear-text nội bộ. Ghi rõ rủi ro; khuyến nghị mạng cách ly/VLAN; TLS/HTTPS nếu firmware hỗ trợ là future.
NFR-FGC-001-007 (Fragility): API reverse-engineer (không chính thức) → firmware update có thể đổi tham số; cô lập sau port + hằng số tập trung để dễ sửa.
```

## 9. Acceptance Criteria

```text
AC-FGC-001-001 (parse ok): parseResponse('root.ERR.no=0\nroot.LIST.uid=64') → errNo=0, root.LIST.uid='64'.
AC-FGC-001-002 (parse err): errNo từ root.ERR.no; thiếu → -1; dòng rác bỏ qua.
AC-FGC-001-003 (addPerson ok): mock HTTP trả ERR.no=0 → {ok:true}; URL chứa action=add, uname đã encode, uvalidbegintime/endtime đúng format.
AC-FGC-001-004 (addPerson device_error): ERR.no=5 → FaceDeviceError(device_error,errNo=5).
AC-FGC-001-005 (deletePerson): URL chứa action=del&LIST.uid=<uid>; ERR.no=0 → ok.
AC-FGC-001-006 (findUidByName): list trả nhiều bản ghi, match uname → uid đúng; không match → null; phân trang dừng đúng.
AC-FGC-001-007 (auth mask): Authorization='Basic ...' đặt đúng; log KHÔNG chứa username/password/Authorization.
AC-FGC-001-008 (timeout): HTTP treo > timeout → FaceDeviceError(timeout), không hang.
AC-FGC-001-009 (uploadFace isolate): chưa impl → FaceDeviceError(not_implemented); các method khác không phụ thuộc.
AC-FGC-001-010 (SEC-03): uname có ký tự đặc biệt/space → encode đúng trong URL.
AC-FGC-001-011 (E1 tz thiết bị): validFrom=2026-06-17T01:00:00Z + FACEGATE_TZ=UTC+7 → uvalidbegintime='2026-06-17 08:00:00' (KHÔNG '2026-06-17 01:00:00'); uvalidDateBeg/uvalidTimeBeg suy cùng tz.
AC-FGC-001-012 (E2 robust): getWhitelist trả format chỉ số khác kỳ vọng / không tách được entry → parseWhitelistEntries=[] → findUidByName=null, KHÔNG crash/ném.
```

## 10. Test Plan

```text
Unit (mock global fetch / AbortController) ≥80%:
- parseResponse: ok/err/missing-ERR/rác.
- addPerson: dựng URL đúng (assert query: action=add, uname encode, uvalidbegin/endtime fmt, CFGIpcJurisdiction); ERR.no=0→ok / ≠0→device_error.
- deletePerson: URL action=del + uid; ok/err.
- findUidByName: nhiều trang, match/không match, dừng phân trang.
- auth: Authorization header Basic đúng; mask trong log (spy logger — không lộ creds).
- timeout: fetch không resolve → AbortController → FaceDeviceError(timeout).
- uploadFace: ném not_implemented.

Smoke cam thật (192.168.1.222, thủ công khi build — KHÔNG trong CI):
- uploadFace: REVERSE-ENGINEER tại đây (capture POST upload / dò /webs/setUploadFile / getUploadPercent) → chốt FaceFileRef.
- parseWhitelistEntries (E2): xác nhận cấu trúc list response thật → chốt cách trích (uname,uid).
- end-to-end: uploadFace → addPerson(validity ngắn) → findUidByName lấy uid → deletePerson(uid) → verify getWhitelist sạch.
- KHÔNG commit creds/ảnh thật.
```

### 10.1 Definition of Done (E3)
```text
Ticket A DONE chỉ khi:
[ ] Unit ≥80% (mock fetch): parse/add/del/find/auth-mask/timeout/uploadFace-not_implemented/tz/robust-list.
[ ] uploadFace ĐÃ reverse-engineer (không còn not_implemented) — not_implemented chỉ là trạng thái TẠM cho unit/dev.
[ ] parseWhitelistEntries chốt theo response thật (E2).
[ ] Smoke END-TO-END trên cam thật PASS: upload → add(validity) → find(uid) → delete → list sạch.
[ ] build/lint/jest xanh; creds mã hoá, không log; FACEGATE_TZ/FACEGATE_TIMEOUT_MS qua env.
⇒ Nếu uploadFace chưa reverse-engineer xong → A CHƯA done (chỉ là partial cho B mock).
```

## 11. [NEEDS CLARIFICATION]

| # | Vấn đề | Đề xuất |
|---|---|---|
| **NC-1** | HTTP client: global fetch vs https module. | **global fetch + AbortController** (Node LTS, không thêm dep). |
| **NC-2** | `jurisdiction` (CFGIpcJurisdiction.bIPC_Enable*) mặc định. | Mặc định **bật tất cả door** (giống mẫu đã quan sát); B truyền cụ thể nếu cần giới hạn theo phòng. |
| **NC-3** | findUidByName khi trùng uname. | uname nên **duy nhất per active enrollment** (B đảm bảo, vd userId hoặc userId:bookingId); nếu trùng → trả bản ghi mới nhất. |
| **NC-4** | uploadFace request (ẩn số). | Reverse-engineer cam thật khi build (đã cô lập 1 hàm); cho tới đó ném not_implemented. |
| **NC-5** (E2) | Cấu trúc response `getWhitelist list` (cách đánh số bản ghi + tên field). | Cô lập `parseWhitelistEntries`; chốt khi smoke; robust → [] nếu format lạ (không crash). |
| **NC-6** (E1) | tz format thời gian validity. | `FACEGATE_TZ` (default Asia/Ho_Chi_Minh) — tz THIẾT BỊ, không UTC/tz-server. |

> **Note cho Ticket B (KHÔNG sửa A)**: `uname = userId:bookingId` (duy nhất per enrollment); `jurisdiction` theo phòng nếu cam đa cửa; truyền đủ validity sub-fields. Adapter A chỉ nhận tham số, không tự quyết các giá trị này.

---

> Trạng thái: **CHỜ REVIEW spec** (adapter-only; uploadFace + parseWhitelistEntries cô lập chờ reverse-engineer; DoD E3). Chưa code.
