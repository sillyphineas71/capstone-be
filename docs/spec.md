# SMRMPTS — Technical Specification

**Smart Meeting Room Monitoring and Presence Tracking System**
*(SMRMPTS — SEP490_G61)*

> **Phiên bản:** v2.0 — Tháng 06/2026
> **Vai trò biên soạn:** Business Analyst & Solution Architect
> **Phạm vi:** Kiến trúc hệ thống, Use Case Catalog (MoSCoW), Business Rules, Kế hoạch 4 tháng / 6 dev.
> **Thay đổi so với v1.0:** Bổ sung Business Rules tách riêng, Acceptance Criteria (Gherkin) cho UC critical, decision matrix giao tiếp module, capacity planning định lượng, outbox pattern đầy đủ, WebSocket scaling decision, recording lifecycle cứng, RPO/RTO, kế hoạch dự phòng 5-dev, và 7 vấn đề khác phát hiện qua review v1.

---

## Mục lục

- [Tóm tắt điều hành](#tóm-tắt-điều-hành)
- [Phần A — Kiến trúc hệ thống](#phần-a--kiến-trúc-hệ-thống)
- [Phần B — Use Case Catalog & Business Rules](#phần-b--use-case-catalog--business-rules)
- [Phần C — Kế hoạch triển khai 4 tháng](#phần-c--kế-hoạch-triển-khai-4-tháng)
- [Phụ lục](#phụ-lục)

---

## Tóm tắt điều hành

Tài liệu này tổng hợp kiến trúc đề xuất, danh mục use case ưu tiên, business rules cốt lõi, và kế hoạch triển khai 4 tháng cho hệ thống Smart Meeting Room Monitoring and Presence Tracking System (SMRMPTS) — đề tài capstone SEP490_G61. Tài liệu được viết với cương vị Business Analyst và Solution Architect, dựa trên phân tích Report 1, Feature Table và bản SRS sơ bộ mà team đã cung cấp; phiên bản v2.0 bổ sung kết quả review chéo bởi 3 vai trò Senior Dev / Architect / BA.

### Đánh giá scope hiện tại

Scope mô tả trong Report 1 và Feature Table tham vọng ở mức enterprise: ~140 function trải dài 15 nhóm, đụng đồng thời 3 hệ con phức tạp — Web App (NestJS + React), IoT pipeline (Face Server callback + RTSP + FFmpeg), và Speech-to-Text pipeline (multi-channel audio + Google STT). Với năng lực thực tế 6 dev × 4 tháng (~16 tuần làm việc), nếu giữ nguyên scope, xác suất delivery thành công thấp.

**Khuyến nghị chiến lược:** phân tầng MoSCoW chặt chẽ. Chỉ cam kết Must (bắt buộc) và Should (rất nên) trong scope demo; xếp Could (có thể) làm differentiator nếu còn time; loại Won't (chưa làm) khỏi commitment ban đầu để bảo vệ chất lượng.

### Định hướng kiến trúc

- **Phong cách:** Modular Monolith cho backend chính + Microservices nhỏ cho IoT/Recording. Tránh phân tán quá sớm vì team capstone không có DevOps mạnh.
- Tách boundary rõ giữa Web App (NestJS), Camera Service (Python), Recording Worker (Node + FFmpeg) — giao tiếp qua REST + Message Queue với contract JSON Schema versioned.
- Ưu tiên xây simulator cho thiết bị IoT từ Sprint 0 để decouple với rủi ro hardware.
- Sử dụng PostgreSQL + Redis + BullMQ + MinIO (thay AWS S3 để tiết kiệm credit). Có thể swap sang AWS S3 production với cùng SDK.
- Áp dụng Event-Driven nội bộ (NestJS EventEmitter + Outbox Pattern cho email) để decoupling module nhưng vẫn ở trong 1 process. **Quy tắc rõ:** EventEmitter cho event in-process không cần persistence; BullMQ cho event cross-process hoặc cần retry/durability (xem §A.2.5).

### Mục tiêu delivery 4 tháng

- **M1** (cuối tháng 1): nền tảng + Auth + Account + Room. Demo: đăng nhập, tạo phòng, tạo user.
- **M2** (cuối tháng 2): Meeting lifecycle + Face Attendance happy path. Demo: tạo cuộc họp, người tham dự scan face → có attendance.
- **M3** (cuối tháng 3): Camera occupancy + No-show + Recording + Dashboards. Demo: full meeting lifecycle, no-show auto-release, recording playback.
- **M4** (cuối tháng 4): Hardening + tối thiểu 1 feature Extended (đề xuất: STT offline + minutes draft) + UAT + báo cáo cuối.

---

# Phần A — Kiến trúc hệ thống

## A.1. Architectural Drivers & Yêu cầu phi chức năng (NFR)

Trước khi quyết định phong cách kiến trúc, cần làm rõ các driver định hình thiết kế. Đây là các yêu cầu phi chức năng (NFR) mà capstone phải đạt; mọi quyết định kiến trúc dưới đây phải truy vết về các driver này.

### A.1.1. Quality Attributes ưu tiên

| Thuộc tính | Mục tiêu định lượng | Lý do chọn | Cách đo |
|---|---|---|---|
| Tính sẵn sàng | ≥ 99% giờ hành chính (8:00-18:00 T2-T6) | Cuộc họp đang diễn ra mà API chết → mất attendance record | Uptime monitor 5 phút/lần |
| Hiệu năng API | p95 < 500ms cho REST API thông thường, p95 < 1s cho aggregate query | Trải nghiệm web app mượt | Backend logging + load test tuần cuối |
| Real-time latency | WebSocket push: từ event xảy ra đến hiển thị UI < 2s p95 | Dashboard room status, presence list | End-to-end test với synthetic event |
| Khả năng mở rộng (target capstone) | 200 user đồng thời, 50 phòng, 100 meeting/ngày, 5 recording session đồng thời | Phù hợp size tổ chức medium | Load test cuối Sprint 7 |
| Bảo mật | JWT + RBAC + bcrypt + HTTPS only; PII (face, recording) encrypted at rest | Yêu cầu bắt buộc hội đồng phản biện | Security checklist + manual review |
| Khả năng quan sát (Observability) | Structured log mọi API; correlation ID xuyên suốt request | Debug khi tích hợp IoT thất bại | Log review |
| Khả năng kiểm thử | Unit coverage > 60% cho domain logic; integration test cho 5 luồng critical; AC Gherkin pass 100% cho UC MUST | Bảo vệ chất lượng khi refactor | Coverage report + test runner |
| **RPO / RTO** *(NEW v2)* | RPO ≤ 24h (mất tối đa 1 ngày data); RTO ≤ 4h (khôi phục trong vòng 4 giờ) | Capstone không yêu cầu HA cứng nhưng phải có plan | Restore drill cuối Sprint 6 |

### A.1.2. Constraints (Ràng buộc)

| Loại | Ràng buộc | Tác động |
|---|---|---|
| Thời gian | 4 tháng, deadline cứng cuối Sprint 8 | Phải cắt scope; không có time để đổi tech stack giữa chừng |
| Nhân lực | 6 dev (1 leader + 5 member); không có dedicated QA/DevOps/PM | Tech Lead phải kiêm review + integration; mỗi dev phải tự test. **Có kế hoạch dự phòng 5-dev (§C.1.2).** |
| Hardware | Face Terminal + IP Camera có thể chưa sẵn | Bắt buộc có simulator từ Sprint 0; integration test thật phải xong trước Sprint 6 |
| Ngân sách Cloud | Capstone không có budget AWS lớn | Dùng MinIO + Postgres + Redis tự host trong dev; AWS chỉ ở môi trường demo |
| Knowledge cutoff | Team chưa làm IoT trước đây | Sprint 0 phải có spike kỹ thuật cho RTSP và Face Server callback |
| External dependency | Google STT phụ thuộc credit + network | STT phải optional; có fallback skip STT khi quota hết |
| **Pháp lý PDPA VN** *(NEW v2)* | Nghị định bảo vệ dữ liệu cá nhân có hiệu lực; recording + face data thuộc dữ liệu nhạy cảm | Phải có consent flow rõ ràng (BR-PRIV-01), anonymize thay xóa cứng (BR-PRIV-02) |

### A.1.3. Architecturally Significant Requirements (ASR)

Các yêu cầu có ảnh hưởng quyết định lên kiến trúc — không chỉ là chức năng mà là điểm xoay của thiết kế:

- **ASR-1:** Hệ thống phải tiếp nhận event không đồng bộ từ Face Server và Camera Service mà không làm chậm UX của Web App → tách Ingestion API khỏi Business API, hoặc dùng queue.
- **ASR-2:** Quá trình ghi hình kéo dài 30-90 phút phải không chặn API thread → Recording Worker phải là process riêng (FFmpeg child process).
- **ASR-3:** Một meeting có thể bị "no-show" tự động và auto-release phòng sau X phút → cần Scheduler ổn định (BullMQ delayed job), không dùng setTimeout.
- **ASR-4:** Email notification phải gửi reliably (không mất khi server restart) → Outbox pattern + BullMQ retry + DLQ (chi tiết §A.9.6).
- **ASR-5:** Hardware vendor có thể đổi (Face Server / IP Camera khác model) → Adapter pattern, port-adapter giao tiếp qua interface chuẩn hóa nội bộ.
- **ASR-6:** Recording video chứa PII → encryption at rest + signed URL có TTL phù hợp + audit log mọi lần access (chi tiết §A.9.9).
- **ASR-7** *(NEW v2)*: Mọi external event (Face Server, Camera Service) phải được rate-limited để tránh DoS vô tình từ vendor bug → ingestion endpoint có circuit breaker (chi tiết §A.9.8).

---

## A.2. Lựa chọn phong cách kiến trúc

### A.2.1. So sánh các options

| Phong cách | Ưu | Nhược | Phù hợp? |
|---|---|---|---|
| Monolith truyền thống | Đơn giản nhất, deploy nhanh | Module quyện chặt; khó tách boundary; khó test | Không |
| Modular Monolith | Boundary rõ; dễ test; deploy 1 đơn vị; có thể tách microservice sau | Cần kỷ luật về module boundary từ đầu | ✅ **Chọn** |
| Microservices đầy đủ | Scale độc lập, ngôn ngữ tự do | Tốn DevOps; team capstone không cover nổi distributed tracing/service mesh | Không |
| Serverless | Auto-scale, rẻ ở low traffic | Cold start; phức tạp cho stateful WebSocket + recording stream | Không |

### A.2.2. Quyết định

**Lựa chọn:** Modular Monolith cho Backend chính (NestJS) + 2 Microservice nhỏ tách riêng (Camera Service bằng Python, Recording Worker bằng Node+FFmpeg).

**Lý do:** (1) Backend nghiệp vụ tập trung trong 1 NestJS app dễ quản lý và test cho team 6 người; (2) Camera Service và Recording Worker thực hiện công việc khác biệt về tính chất (xử lý stream, chạy process FFmpeg dài) nên tách thành service riêng để không làm sập API; (3) Tách 3 thành phần này cho phép scale độc lập sau này và là chuẩn industry.

### A.2.3. Bounded Context & Module

Backend NestJS được tổ chức thành các module có boundary rõ. Mỗi module có Controller, Service, Repository, DTO riêng. Giao tiếp giữa các module tuân theo §A.2.4.

| # | Module / Bounded Context | Trách nhiệm chính | Module phụ thuộc |
|---|---|---|---|
| M1 | Identity & Access | User, Role, Permission, JWT, Session, OTP reset | (none) |
| M2 | Organization | Department, hierarchy, user-department mapping | M1 |
| M3 | Room & Facility | Room CRUD, equipment, room-equipment assignment | M2 |
| M4 | Meeting | Meeting, MeetingOccurrence, Participant, Agenda | M1, M2 |
| M5 | Scheduling | Conflict detection, booking approval, room suggestion | M3, M4 |
| M6 | IoT Device | Device registry, heartbeat, raw event ingestion, normalization | (none) |
| M7 | Attendance | Face event → AttendanceRecord; manual override; unknown face | M4, M6 |
| M8 | Occupancy | Camera event → RoomOccupancy state machine; presence snapshot | M3, M6 |
| M9 | No-show | No-show case lifecycle, auto-release, manual release | M4, M5, M8 |
| M10 | Recording | Recording session, start/stop command, media file metadata | M4, M6 |
| M11 | Transcription (Ext.) | Audio segment → STT → transcript | M10 |
| M12 | Minutes (Ext.) | Draft, publish, attachment, link recording/transcript | M4, M10, M11 |
| M13 | Notification | Outbox + email job + WebSocket push | (other modules emit events) |
| M14 | Analytics | Dashboard query, aggregation, export PDF/Excel | M3-M10 (read-only) |
| M15 | Audit & Logging | Cross-cutting: structured log, audit trail | (cross-cutting) |

### A.2.4. ⚡ NEW Quy tắc giao tiếp giữa các module

Đây là rule cứng để bảo vệ boundary của Modular Monolith. Vi phạm là code-smell phải refactor trong sprint phát hiện.

**Layered allowed-direction:**

```
Controller → Application Service (cùng module)
Application Service → Application Service khác (chỉ qua interface public)
Application Service → Domain Event (EventEmitter)
KHÔNG ĐƯỢC: Repository → Repository (cross-module)
KHÔNG ĐƯỢC: Controller → Service khác module
KHÔNG ĐƯỢC: Service A truy cập DB table của Module B trực tiếp
```

**3 cách giao tiếp được phép:**

| # | Pattern | Khi nào dùng | Ví dụ |
|---|---|---|---|
| 1 | **Public Service Call** (sync, in-process) | A cần dữ liệu/quyết định ngay từ B; coupling chấp nhận được | MeetingService gọi RoomService.getRoomById() |
| 2 | **Domain Event** (async, in-process, EventEmitter) | A xong việc, các module khác có thể quan tâm; fire-and-forget | meeting.created → NotificationListener, AnalyticsListener |
| 3 | **Job Queue** (async, cross-process, BullMQ) | Cần persistence (mất event là mất data); cần retry; cross-process | email send, no-show check, recording start |

**Forbidden patterns:**

- ❌ Cross-module raw SQL JOIN (vd Attendance service query trực tiếp `meetings`)
- ❌ Repository inject từ module khác (vd `MeetingRepository` inject vào `AttendanceService`)
- ❌ Chia sẻ Prisma model giữa module (mỗi module có DTO/Entity riêng, ánh xạ từ Prisma)
- ❌ Circular dependency giữa module (lint rule check ở CI)

**ESLint rule (Sprint 0 phải setup):**

```json
{
  "rules": {
    "boundaries/element-types": ["error", {
      "default": "disallow",
      "rules": [
        { "from": "controller", "allow": ["service-same-module"] },
        { "from": "service", "allow": ["service-public-other-module", "event-emitter", "queue"] }
      ]
    }]
  }
}
```

### A.2.5. ⚡ NEW Decision Matrix: EventEmitter vs BullMQ vs Sync Call

Khi cần giao tiếp giữa 2 phần code, dùng bảng dưới đây để chọn:

| Tiêu chí | Sync Service Call | EventEmitter (in-process) | BullMQ Job |
|---|---|---|---|
| Caller cần kết quả ngay? | ✅ Có | ❌ Không | ❌ Không |
| Mất event = mất data nghiệp vụ? | N/A | ❌ Không chịu được mất | ✅ Phải persistence |
| Có retry tự động? | ❌ Không (phải code) | ❌ Không | ✅ Có |
| Cross-process? | ❌ Không | ❌ Không | ✅ Có |
| Delay execution? | ❌ Không | ❌ Không | ✅ Có |
| Latency overhead | < 1ms | < 10ms | 10-100ms |

**Quyết định nhanh theo loại event:**

| Event | Chọn | Lý do |
|---|---|---|
| `meeting.created` → push email vào outbox | EventEmitter | Outbox đảm bảo persistence; emit là chỉ trigger listener |
| `email.outbox.send` (worker pickup) | BullMQ | Cần retry, cần process riêng, mất email là mất commitment với user |
| `face.event.received` → process attendance | BullMQ | Mất event = sai attendance; phải retry; high volume |
| `attendance.recorded` → WebSocket push | EventEmitter | UI miss 1 event không sao (state sẽ tự sync khi reconnect) |
| `noshow.detected` → schedule auto-release sau 5 phút | BullMQ delayed | Delayed job native của BullMQ; setTimeout không survive restart |
| `recording.start` → spawn FFmpeg | BullMQ | Cross-process (Recording Worker khác process với API) |
| Cập nhật analytics counter | EventEmitter | Loss tolerable; eventual consistency OK với dashboard |

---

## A.3. Sơ đồ Context (C4 Level 1)

Sơ đồ Context mô tả ranh giới hệ thống và các actor/system bên ngoài tương tác. Đây là góc nhìn cao nhất.

```
+----------------------------------------------------------------------+
|                          SMRMPTS (Hệ thống)                          |
|                                                                      |
|   Quản lý vòng đời cuộc họp: scheduling → attendance → recording     |
|   → reporting; tích hợp IoT để xác thực hiện diện thật.              |
+----------------------------------------------------------------------+
        ▲              ▲              ▲              ▲
        |              |              |              |
[Employee/Host]  [Manager/Approver]  [Business     [System
 - Tạo/quản lý    - Phê duyệt booking  Admin]        Admin]
   meeting        - Xem dashboard      - Quản lý     - Cấu hình
 - Check-in qua   - Phân tích KPI       phòng,        IoT, recording
   Face Terminal                        thiết bị,     policy, audit
 - Xem minutes                          tài khoản

                  HỆ THỐNG NGOÀI (External Systems)
                  ───────────────────────────────────
   [Face Server]            [IP Camera RTSP]         [Google Cloud STT]
   - Push verify/stranger    - Stream video           - Convert audio
     event qua callback        cho Camera Service       → transcript
   - Heartbeat                                          (Extended)

   [SMTP Email Provider]    [(Tùy chọn) AWS S3 / MinIO]
   - Gửi invite, reminder    - Lưu recording, attachment
     cancel, OTP             - Signed URL playback
```

### A.3.1. Bảng các actor (đã làm rõ Manager vs Approver — xem BR-ROLE-01)

| Actor | Loại | Mô tả |
|---|---|---|
| Employee | Internal user | Người tham dự thông thường; xem lịch họp cá nhân; check-in qua Face Terminal |
| Meeting Host | Internal user (role) | Một Employee được chọn làm chủ trì 1 cuộc họp; có quyền cấu hình meeting đó |
| **Department Manager** *(NEW v2)* | Internal user (role) | Quản lý nhân sự 1 phòng ban; xem dashboard phạm vi phòng ban |
| **Approver** *(NEW v2)* | Internal user (role) | Phê duyệt booking theo policy BR-BOOK-01; có thể trùng Department Manager nhưng là role kỹ thuật riêng |
| Business Admin | Quản trị nghiệp vụ | Quản lý phòng, thiết bị, tài khoản, đặt phòng đột xuất |
| System Admin | Quản trị kỹ thuật | Cấu hình IoT device, RTSP, callback, recording policy, audit log |
| Face Server | External system | Vendor thiết bị, push verify/stranger event |
| IP Camera | External hardware | Cấp video stream RTSP cho Camera Service và Recording Worker |
| Google Cloud STT | External SaaS | Convert audio sang transcript (chỉ ở scope Extended) |
| SMTP Provider | External SaaS | Gửi email; dùng Mailtrap/Gmail SMTP cho dev, SES cho demo |

---

## A.4. Sơ đồ Container (C4 Level 2)

Container đại diện cho đơn vị có thể deploy độc lập. Mỗi mũi tên dưới đây là một giao tiếp thực tế giữa các process.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (Browser)                            │
│   React SPA  ──  TanStack Query  ──  WebSocket Client               │
└──────────┬─────────────────────────────────┬────────────────────────┘
           │ HTTPS (REST + JWT)              │ WSS (real-time)
           ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│              BACKEND API (NestJS - Modular Monolith)                │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐     │
│  │  REST API Layer │  │ WebSocket       │  │ IoT Ingestion    │     │
│  │  (Guards, DTO)  │  │ Gateway         │  │ Endpoint         │     │
│  │  + Rate Limit   │  │ + Redis Adapter │  │ + Rate Limit     │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬─────────┘     │
│           ▼                    ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Application Services (15 module - xem A.2.3)           │        │
│  │  Domain Events (EventEmitter) + Outbox                  │        │
│  └─────────────────────┬───────────────────────────────────┘        │
│                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Infrastructure: TypeORM, Redis Client, Mail, S3 SDK │        │
│  └──┬────────────────┬──────────────┬────────────┬─────────┘        │
└─────┼────────────────┼──────────────┼────────────┼─────────────────┘
      ▼                ▼              ▼            ▼
 ┌──────────┐   ┌────────────┐  ┌─────────┐  ┌──────────┐
 │PostgreSQL│   │   Redis    │  │  MinIO  │  │   SMTP   │
 │  (data)  │   │(cache+BullMQ│ │ /AWS S3 │  │  Server  │
 │ + WAL    │   │ + WS adptr) │ │ (media) │  └──────────┘
 │ archive  │   │ + AOF persist│└─────────┘
 └──────────┘   └─────┬──────┘
                      │
                      ▼
          ┌──────────────────────┐
          │   BullMQ Workers     │
          │  - Email job (outbox)│
          │  - Face event proc.  │
          │  - No-show check     │
          │  - Auto-release      │
          │  - STT job (Ext.)    │
          │  - DLQ handler       │
          └──────────────────────┘

 ┌──────────────────────────┐    ┌────────────────────────────┐
 │  CAMERA SERVICE (Python) │    │  RECORDING WORKER (Node)   │
 │  - Connect RTSP          │    │  - Spawn FFmpeg process    │
 │  - Detect occupancy      │    │  - Record from RTSP → MP4  │
 │  - POST event tới        │    │  - Health-check FFmpeg     │
 │    Backend Ingestion     │    │  - Upload S3 sau khi xong  │
 │  - Backpressure: drop    │    │  - Update metadata via API │
 │    snapshot nếu API slow │    │  - Cleanup orphan procs    │
 └──────────┬───────────────┘    └────────────┬───────────────┘
            │                                 │
            │     ┌──────────────────────┐    │
            └────►│ IP Camera (RTSP)     │◄───┘
                  └──────────────────────┘

 ┌──────────────────────────┐
 │  FACE SERVER (Vendor)    │
 │  - Trên Door Terminal    │
 │  - Callback HTTP POST    │──► Backend IoT Ingestion Endpoint
 │    tới Backend (HMAC sig)│
 └──────────────────────────┘
```

### A.4.1. Danh sách Container & lý do tách

| Container | Công nghệ | Trách nhiệm | Lý do tách riêng |
|---|---|---|---|
| Frontend SPA | React 18 + TS + Vite + TanStack Query + Tailwind + shadcn/ui | UI cho mọi role | Tách FE/BE chuẩn; deploy CDN/S3 |
| Backend API | NestJS + TypeORM + TypeScript | Business logic, REST, WebSocket, Ingestion | Trung tâm hệ thống; gom tất cả module nghiệp vụ |
| BullMQ Workers | Node (cùng codebase NestJS, chạy process riêng với cmd `node worker.js`) | Email, face event proc, no-show check, auto-release, STT, export | Tách process để không chặn API thread; restart độc lập |
| Camera Service | Python + OpenCV/imageio-ffmpeg | Đọc RTSP, detect occupancy, push event | Python ecosystem mạnh về CV; tách khỏi NestJS |
| Recording Worker | Node + ffmpeg-static + supervisor | Spawn FFmpeg child process ghi MP4 + cleanup orphan | Process FFmpeg dài (30-90 phút), không phù hợp trong API |
| PostgreSQL | Postgres 16 + WAL archiving | Source of truth cho mọi dữ liệu nghiệp vụ | RDBMS phù hợp domain quan hệ phức tạp |
| Redis | Redis 7 với AOF persistence + RDB snapshot | Cache, session, BullMQ broker, rate limit, WS adapter, FFmpeg PID registry | In-memory store chuẩn cho job queue + cache. **AOF bật bắt buộc** để không mất queue khi crash. |
| MinIO / AWS S3 | MinIO (dev) / S3 (demo) | Lưu recording, attachment, export file | Object storage, signed URL, dễ scale |

---

## A.5. Quyết định Tech Stack (ADR rút gọn)

Mỗi lựa chọn dưới đây được ghi lại dưới dạng Architecture Decision Record (ADR) rút gọn. Khi cần thay đổi, team phải tạo ADR mới và link tới ADR cũ. **Mỗi ADR bắt buộc có 4 trường: Context, Decision, Consequences (Positive/Negative), Status.**

| # | Quyết định | Đã chọn | Đã loại | Lý do |
|---|---|---|---|---|
| ADR-01 | Backend framework | NestJS | Express thuần, Spring Boot | Module DI chuẩn, Guard/Pipe built-in, TS, doc tốt |
| ADR-02 | ORM | TypeORM | Prísma, Sequelize | Type-safe, migration tốt, doc rõ |
| ADR-03 | Database | PostgreSQL 16 | MySQL, MongoDB | ACID, JSONB cho event payload, FTS, btree_gist cho exclude constraint |
| ADR-04 | Queue | BullMQ + Redis | RabbitMQ, Kafka | Đơn giản, dashboard có sẵn, đủ throughput capstone |
| ADR-05 | Frontend | React + Vite + TS | Next.js, Vue | SPA pure đủ dùng; SSR không cần |
| ADR-06 | Data fetching | TanStack Query | Redux + thunk, SWR | Caching, refetch logic mạnh; giảm boilerplate |
| ADR-07 | UI library | Tailwind + shadcn/ui | Ant Design, MUI | Linh hoạt, copy component, không lock-in |
| ADR-08 | Object storage | MinIO (dev) → S3 (demo) | Local FS | S3 SDK chung; demo lên cloud không đổi code |
| ADR-09 | Recording | FFmpeg as child process | GStreamer, MediaSoup | FFmpeg phổ biến, doc nhiều, đủ cho ghi RTSP |
| ADR-10 | Camera occupancy | Python + OpenCV (motion + person detection với YOLOv8n) | Tự train ML | Capstone không có thời gian/data train; dùng pretrained |
| ADR-11 | STT (Extended) | Google Cloud STT (single channel) | Whisper self-host, Azure | Quota free đủ demo; setup đơn giản |
| ADR-12 | Email | Nodemailer + SMTP (Mailtrap dev, Gmail/SES demo) | SendGrid | Free tier; có queue + retry qua BullMQ |
| ADR-13 | Auth | JWT access (15p) + Refresh (7d) trong DB với jti | Session cookie, OAuth | Stateless API, mobile-ready, dễ revoke qua DB |
| ADR-14 | Logging | Winston + Loki/local file (dev) → CloudWatch (demo) | ELK | Loki nhẹ, dev local OK |
| ADR-15 | Containerization | Docker Compose (dev), Docker Compose hoặc bare metal (demo) | Kubernetes | K8s thừa cho capstone; team không có DevOps chuyên |
| **ADR-16** *(NEW)* | WebSocket scaling | **1 instance NestJS** + Socket.IO Redis adapter sẵn sàng | Multi-instance từ đầu | Capstone target 200 user fit 1 instance; adapter giảm cost migration sau |
| **ADR-17** *(NEW)* | Conflict prevention DB | PostgreSQL **EXCLUDE USING GIST** với tstzrange | Application-level lock, SELECT FOR UPDATE | Atomic ở DB-level, không có race condition; không phụ thuộc app code |
| **ADR-18** *(NEW)* | Long media playback URL | Signed URL TTL = ceil(duration × 1.5) + 30 phút, min 1 giờ | TTL cứng 15 phút | Tránh URL expire giữa lúc user đang xem video dài |
| **ADR-19** *(NEW)* | Privacy của face data | Backend KHÔNG lưu face image gốc/embedding; chỉ lưu person_code reference từ Face Server | Lưu trong DB chính | Giảm bề mặt PII; nếu Face Server vendor đổi, chỉ remap |
| **ADR-20** *(NEW)* | API versioning | URL versioning `/api/v1/...`; major version mới khi breaking | Header versioning | URL versioning dễ test, dễ deploy parallel |

---

## A.6. Topology triển khai

Có 3 môi trường:

- **Local Dev:** Docker Compose chạy tất cả service trên máy dev. Mỗi dev có instance riêng. Postgres + Redis + MinIO + 1 container BE + 1 container FE.
- **Staging (sau Sprint 2):** 1 VPS (4 core, 8GB RAM) tự host. Docker Compose. Có domain dev.smrmpts.local, HTTPS bằng Caddy/Traefik tự cấp cert. Integrate được với Face Terminal thật khi có hardware.
- **Demo / UAT (Sprint 6+):** VPS riêng hoặc AWS EC2 t3.medium. Có thể swap MinIO → AWS S3 thật, SMTP → AWS SES. Backup Postgres hằng đêm + WAL archive.

### A.6.1. Docker Compose topology (Staging)

```yaml
services:
  postgres:        # port 5432, volume persistent, WAL archiving on
  redis:           # port 6379, AOF=always, RDB snapshot 5min
  minio:           # port 9000 (API), 9001 (Console)
  backend-api:     # port 3000 - NestJS API + WebSocket
  backend-worker:  # cùng image với backend-api, command: "node worker.js"
  recording-worker:# Node + FFmpeg, listen queue 'recording'
  camera-service:  # Python, kết nối RTSP, push event tới backend-api
  frontend:        # nginx serve React build
  caddy:           # reverse proxy, TLS auto, route 80/443

# Network: tất cả trong 1 docker network nội bộ
# Volume: postgres_data, postgres_wal, redis_data, minio_data, recording_temp
# Health check: mọi service có healthcheck; depends_on với condition: service_healthy
```

### A.6.2. ⚡ NEW Capacity Planning Math

Dẫn xuất từ NFR (200 user, 50 phòng, 100 meeting/ngày, 5 recording đồng thời):

**A. API request rate:**
- Active user trong giờ hành chính: 200 × 60% = 120 user
- Request/user/phút trung bình: 3 (xem lịch, check status, etc.)
- → ~6 RPS thường, peak ~20 RPS khi vào ca

**B. Database connection:**
- API: 20 RPS × 2 query/req = 40 query/s → pool 20 connections đủ với p95 100ms
- Worker (BullMQ): 5 connections
- Camera Service push: 50 phòng × 1/30s = 1.67 RPS, ingestion light → 5 connections
- Recording Worker: 2 connections
- **Total pool: 35-40, Postgres `max_connections` set 100 (an toàn)**

**C. WebSocket:**
- 200 concurrent connections, mỗi connection subscribe 1-3 topic
- Memory: ~50KB/connection (Node default) → 10MB tổng
- Push rate peak: 50 phòng × 1 occupancy update/30s = 1.67 push/s/server (broadcast)
- → 1 instance Node đủ, chưa cần horizontal scale

**D. RTSP bandwidth (cho Recording Worker):**
- IP Camera 1080p H.264: ~2-3 Mbps/stream
- 5 recording đồng thời: 5 × 3 Mbps = 15 Mbps download từ camera
- VPS 4 core/8GB phải có NIC ≥ 100Mbps (mặc định OK)

**E. FFmpeg CPU:**
- `ffmpeg -c copy` (stream copy, không re-encode): ~5% 1 core/stream
- 5 stream đồng thời: ~25% CPU 1 core
- VPS 4 core: thoải mái

**F. Disk:**
- Recording 1 giờ @ 3 Mbps = ~1.4 GB
- 20 recording/ngày × 1.4 GB = 28 GB/ngày → 90 ngày retention = **2.5 TB**
- → MinIO/S3 phải có dung lượng lớn; staging VPS local disk **không đủ**, phải mount external storage hoặc lên S3 thật từ Sprint 6

**G. Memory profile (VPS 8GB):**
- Postgres: 1.5 GB (shared_buffers 512MB + work_mem)
- Redis: 1 GB
- Backend API: 1 GB (Node V8 heap 512MB)
- Worker: 800 MB
- Recording Worker (idle): 200 MB + (FFmpeg 50MB × 5) = 450 MB
- Camera Service (Python + YOLOv8n): 1 GB (model loaded)
- MinIO: 500 MB
- OS + Caddy + dư: 1.5 GB
- **Total: ~7 GB → VPS 8GB chật, khuyến nghị 16GB khi demo có hardware thật**

### A.6.3. ⚡ NEW Backup / RPO / RTO

| Tài nguyên | RPO | RTO | Cách backup |
|---|---|---|---|
| PostgreSQL data | 24h (full) + < 5 phút (WAL) | < 2h | pg_dump nightly → S3 + WAL archive liên tục → S3 |
| MinIO / Recording media | 24h | < 4h | rclone sync sang S3 thật mỗi đêm (nếu có budget) hoặc tape backup VPS |
| Redis (queue + cache) | 5 phút (AOF) | < 30 phút | AOF persist mỗi giây + RDB snapshot 5 phút; queue replay từ outbox/DB nếu cần |
| Application code | 0 (Git) | < 1h | Git remote (GitHub) |
| Container image | 24h | < 30 phút | GitHub Container Registry |
| Secrets / .env | 7d (manual) | < 1h | Bitwarden / 1Password vault chia sẻ |

**Restore drill bắt buộc:** cuối Sprint 6, team phải làm 1 lần "kill staging" → restore từ backup → đo RTO thực tế. Nếu vượt RTO target, phải fix ngay (Sprint 7 không có buffer cho việc này).

---

## A.7. Kiến trúc dữ liệu (Data Architecture)

Single PostgreSQL database, chia thành các schema theo bounded context để tránh trộn bảng. Migration quản lý qua TypeORM migrate + raw SQL migration cho các constraint TypeORM chưa support (exclude constraint, partial index).

### A.7.1. Sơ đồ ERD logic (rút gọn)

```
[IDENTITY]
  users (id, email, password_hash, status, locked_at, password_changed_at, ...)
  roles (id, code, name)
  user_roles (user_id, role_id)
  permissions (id, code)
  role_permissions
  refresh_tokens (id, user_id, jti, expires_at, revoked_at, revoked_reason)
  password_reset_otps (user_id, otp_hash, expires_at, used_at)

[ORG]
  departments (id, code, name, manager_id, parent_id)
  user_departments (user_id, department_id, position)

[ROOM]
  rooms (id, code, name, capacity, floor, status, requires_approval BOOL,
         approver_strategy ENUM, deactivated_at)
  equipments (id, code, name, type, health_status, current_room_id)
  room_equipment_assignments

[MEETING]
  meetings (id, title, host_id, room_id, scheduled_start, scheduled_end,
            status, recording_enabled, version BIGINT, ...)  -- version cho optimistic lock
  meeting_occurrences (id, meeting_id, occurrence_date, scheduled_start,
                       scheduled_end, actual_start, actual_end, status,
                       overrun_minutes INT, version BIGINT)
  meeting_participants (id, meeting_id, user_id, role, required,
                       consent_recording BOOL, consent_at)
  agendas (id, meeting_id, title, duration_min, order_index, owner_id)
  meeting_extensions (id, occurrence_id, requested_by, minutes, status,
                      approved_by, approved_at)
  meeting_notes (id, occurrence_id, author_id, content, timestamp_in,
                 visibility)

[BOOKING]
  room_booking_usages (id, room_id, occurrence_id, reserved_range tstzrange,
                       actual_start, actual_end, usage_status,
                       released_at, release_reason,
                       EXCLUDE USING GIST (room_id WITH =, reserved_range WITH &&)
                         WHERE (usage_status NOT IN ('CANCELLED','RELEASED')))
  booking_approvals (id, booking_usage_id, approver_id, decision, decided_at,
                     reason)

[IOT]
  iot_devices (id, code, type, ip, mac, room_id, status, last_seen_at,
               hmac_secret_encrypted, metadata_json)
  iot_device_events (id, device_id, event_type, event_schema_version,
                     raw_payload_json, normalized_json, processed,
                     processing_error, retry_count, received_at,
                     correlation_id)
  device_user_mappings (id, device_id, user_id, person_code_external)

[ATTENDANCE]
  attendance_records (id, occurrence_id, user_id, status, source,
                      first_check_in_at, last_check_out_at, total_minutes,
                      UNIQUE(occurrence_id, user_id))
  attendance_events (id, attendance_id, event_type, occurred_at, device_id,
                     evidence_url, idempotency_key UNIQUE)
  unknown_face_events (id, device_id, occurred_at, snapshot_url, room_id,
                       resolved_at, resolved_by)

[OCCUPANCY]
  room_occupancy_snapshots (id, room_id, occurred_at, is_occupied,
                            estimated_headcount, source_event_id,
                            confidence)

[NO-SHOW]
  no_show_logs (id, booking_usage_id, detected_at, status, warning_sent_at,
                released_at, dismissed_by, dismissed_at, note,
                auto_release_job_id VARCHAR)

[RECORDING]
  recording_sessions (id, occurrence_id, camera_device_id, status,
                      started_at, ended_at, error_message, ffmpeg_pid,
                      worker_node_id, heartbeat_at)
  media_files (id, session_id, file_type, file_name, s3_key, duration_sec,
               file_size_bytes, status, retention_until)

[TRANSCRIPT (Extended)]
  audio_segments (id, session_id, channel_id, seat_id, start_ms, end_ms,
                  s3_key)
  transcript_segments (id, segment_id, participant_id, text, confidence,
                       provider, edited_at, edited_by)

[MINUTES (Extended)]
  meeting_minutes (id, occurrence_id, status, content, published_at,
                   published_by, visibility)
  minute_attachments (id, minute_id, file_name, s3_key, size_bytes)
  minute_links (id, minute_id, link_type, target_id)

[NOTIFICATION]
  notifications (id, user_id, type, title, body, read_at, channel)
  email_outbox (id, recipient, template, payload_json, status, attempts,
                last_error, sent_at, idempotency_key UNIQUE,
                next_retry_at, created_at)

[AUDIT]
  audit_logs (id, actor_id, action, entity, entity_id, before_json,
              after_json, occurred_at, ip, correlation_id)
  audit_logs_archive (same schema -- partition by quarter, archive sau 1 năm)
  system_configurations (id, key, value, updated_by, updated_at)

[PRIVACY]
  privacy_consent_logs (id, user_id, scope, granted, granted_at, source)
  data_deletion_requests (id, user_id, requested_at, status, completed_at,
                          anonymized_entities_json)
```

### A.7.2. Naming convention

- Table tên số nhiều, snake_case: `users`, `meeting_occurrences`.
- Khóa chính: `id BIGINT IDENTITY` (hoặc UUID nếu cần distribute). Khuyến nghị BIGINT trong scope capstone.
- Khóa ngoại đặt tên rõ: `meeting_id`, `user_id`, `device_id`.
- Timestamp dùng `timestamptz`, lưu UTC. UI quy đổi sang Asia/Ho_Chi_Minh.
- Soft delete: cột `deleted_at NULL` hoặc `status` enum. Không hard delete bảng có FK.
- Mọi bảng nghiệp vụ có: `created_at`, `updated_at`, `created_by`, `updated_by`.
- Bảng critical (meetings, occurrences, recording_sessions) có cột `version BIGINT` cho optimistic locking.

### A.7.3. Chiến lược index quan trọng

| Bảng | Index cần có | Lý do |
|---|---|---|
| meeting_occurrences | `(room_id, scheduled_start, scheduled_end)` | Conflict detection cực thường |
| meeting_occurrences | `(status, scheduled_start)` | Quét meeting chờ start để no-show check |
| attendance_records | `(occurrence_id, user_id) UNIQUE` | Đảm bảo 1 record/người/cuộc họp |
| attendance_events | `idempotency_key UNIQUE` | Dedup khi vendor gửi event 2 lần |
| iot_device_events | `(device_id, received_at DESC)` | Truy vấn event mới nhất từ device |
| iot_device_events | `(processed, received_at) WHERE processed = false` | Worker quét event chưa xử lý |
| room_booking_usages | `EXCLUDE USING GIST (room_id WITH =, reserved_range WITH &&)` | Atomic conflict prevention (xem A.7.4) |
| audit_logs | `(actor_id, occurred_at DESC)` | Truy vấn lịch sử thao tác |
| email_outbox | `(status, next_retry_at) WHERE status IN ('PENDING','RETRY')` | Worker quét email pending |
| refresh_tokens | `(user_id, revoked_at) WHERE revoked_at IS NULL` | Revoke all tokens nhanh |

### A.7.4. ⚡ NEW Atomic Conflict Prevention — Exclude Constraint

Phòng race condition khi 2 user đồng thời đặt cùng phòng cùng giờ. Dùng PostgreSQL exclude constraint với GIST index trên `tstzrange`.

**Migration raw SQL (TypeORM không generate được, phải viết tay):**

```sql
-- migration: 20260601_120000_booking_exclude_constraint.sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE room_booking_usages
  ADD COLUMN reserved_range tstzrange GENERATED ALWAYS AS
    (tstzrange(reserved_start, reserved_end, '[)')) STORED;

ALTER TABLE room_booking_usages
  ADD CONSTRAINT no_overlap_booking
  EXCLUDE USING GIST (
    room_id WITH =,
    reserved_range WITH &&
  )
  WHERE (usage_status NOT IN ('CANCELLED', 'AUTO_RELEASED', 'MANUAL_RELEASED'));
```

**Cách dùng trong code:** chỉ cần insert; nếu trùng → Postgres throw `23P01 exclusion_violation`. Service catch và map thành `409 SMRMPTS.MEETING.CONFLICT_ROOM`. Không cần `SELECT FOR UPDATE`, không cần app-level lock. Concurrency được DB lo.

### A.7.5. ⚡ NEW Chiến lược archive cho bảng phình to

| Bảng | Tốc độ phình | Chiến lược |
|---|---|---|
| `iot_device_events` | ~5000 row/ngày = 1.8M/năm | Partition theo tháng; row > 90 ngày + `processed=true` → archive table; raw_payload_json giữ tóm tắt |
| `audit_logs` | ~10k row/ngày | Partition quarterly; > 1 năm → `audit_logs_archive` (cùng Postgres hoặc S3 export) |
| `email_outbox` | ~1k row/ngày | Row `status=SENT` và `sent_at > 30 ngày` → xóa cứng (không cần audit) |
| `room_occupancy_snapshots` | 144k/ngày, 50M/năm | Aggregate hourly → bảng `room_occupancy_hourly`, snapshot gốc giữ 30 ngày |
| `media_files` (S3 key tracking) | bám theo recording | Honor `retention_until`, BullMQ scheduled job xóa S3 + row |

---

## A.8. Luồng tương tác chính (Key Sequence Flows)

4 luồng critical phải hiểu kỹ trước khi code. Mỗi luồng dưới đây nên được vẽ lại dưới dạng sequence diagram (PlantUML/Mermaid) trong Report 2.

### A.8.1. Luồng tạo cuộc họp với conflict detection (UC-MTG-01)

```
User (Host) ──[POST /api/v1/meetings]──> API Gateway
                                    │ JWT Guard + Rate Limit
                                    │ DTO Validation
                                    ▼
                              MeetingService
                                    │
                                    ▼
                     SchedulingService.evaluateApproval()
                     (xem BR-BOOK-01: phòng có cần approval không?)
                                    │
                                    ▼
                              BEGIN TX
                                    │
                                    ▼
                       INSERT room_booking_usages
                       (exclude constraint sẽ throw nếu conflict)
                                    │
                ┌───────────────────┴───────────────────┐
                │                                       │
        23P01 exclusion                          OK
        violation                                       │
                │                                       ▼
                ▼                          Tạo meetings + occurrences
       ROLLBACK + return 409              + participants
       SMRMPTS.MEETING.CONFLICT_ROOM      + (nếu cần approval) booking_approvals
                                                        │
                                                        ▼
                                                INSERT email_outbox
                                                (cùng transaction!)
                                                        │
                                                        ▼
                                                   COMMIT
                                                        │
                                                        ▼
                                       EventEmitter.emit('meeting.created')
                                                        │
                                       ┌────────────────┴────────────────┐
                                       ▼                                 ▼
                              AnalyticsListener            (Email sẽ được worker pick up từ outbox)
                              (increment counter)
```

### A.8.2. Luồng Face Attendance (UC-ATT-01)

```
Face Server (vendor) ──[POST /api/v1/iot/face/verify + HMAC sig]
                                  │
                                  ▼
                       IngestionController
                       - Verify HMAC signature
                       - Rate limit per device (100 req/min)
                       - Circuit breaker (open nếu 50% fail trong 1 phút)
                                  │
                                  ▼
                       IoTService.saveRawEvent()
                       (lưu iot_device_events ngay,
                        idempotency_key = device_id + person_code + captured_at)
                                  │
                                  ▼
                       Response 200 OK ngay (< 200ms)
                                  │
                                  ▼
                       BullMQ enqueue 'face-event' với
                       jobId = idempotency_key (dedupe)
                       ────────────────────────────
                                  │
                                  ▼
                             FaceEventWorker
                                  │
                                  ▼
                          normalize payload (theo event_schema_version)
                                  │
                                  ▼
                          DeviceUserMappingService
                          .findUserByPersonCode()
                                  │
                          ┌───────┴───────┐
                          │               │
                        found          not found
                          │               │
                          ▼               ▼
                  AttendanceService    UnknownFaceLog
                  .recordCheckIn()     + EventEmitter
                          │            'unknown.face' → WS
                          ▼
                  Tra cứu meeting đang/sắp diễn ra
                  tại room device đó (within ±15 phút)
                          │
                          ▼
                  Tạo/cập nhật AttendanceRecord
                  (UPSERT với UNIQUE constraint
                   occurrence_id + user_id)
                          │
                          ▼
                  Emit 'attendance.recorded' (EventEmitter)
                          │
                          ▼
                  WebSocket gateway push → room:{room_id} channel
                  (qua Redis adapter để work cả khi >1 instance)
```

### A.8.3. Luồng No-show Detection & Auto-release (UC-NS-01)

```
BullMQ Repeating Job ──> NoShowCheckJob (chạy mỗi phút)
                          │
                          ▼
   SELECT meeting_occurrences WHERE
     scheduled_start <= now() - threshold (default 10 min)
     AND actual_start IS NULL
     AND status = 'SCHEDULED'
     AND NOT EXISTS (no_show_logs entry với status != DISMISSED)
                          │
                          ▼
   Với mỗi occurrence: OccupancyService.isRoomOccupied()
                       (snapshot trong 5 phút gần nhất)
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        Room occupied        Room empty (no signal HOẶC is_occupied=false)
        (theo BR-NS-01)              │
                │                    ▼
                │           BEGIN TX
                │           - Tạo no_show_logs status=DETECTED
                │           - INSERT email_outbox (warning Host)
                │           - jobId = `auto-release:${noShowLogId}`
                │             (idempotent — dùng làm BullMQ jobId)
                │           COMMIT
                │                    │
                │                    ▼
                │           Emit 'noshow.detected'
                │           → WS push 'noshow.warning' tới Host
                │                    │
                │                    ▼
                │           BullMQ.add('auto-release', {logId}, {
                │             delay: grace_minutes * 60_000,
                │             jobId: `auto-release:${logId}`  ← DEDUPE KEY
                │           })
                │                    │
                │                    ▼
                │           [Sau N phút] AutoReleaseJob
                │           - Re-check no_show_logs.status
                │             nếu DISMISSED → SKIP
                │             nếu MANUAL_RELEASED → SKIP
                │           - re-check occupancy (có thể có người đã vào)
                │           - update booking_usage = AUTO_RELEASED
                │           - emit 'room.released'
                ▼
       Skip (đã có hiện diện)
       Log info

──[Host dismiss workflow]──
Host POST /api/v1/no-show/{id}/dismiss
   ─→ Update no_show_logs.status = DISMISSED
   ─→ BullMQ.remove(`auto-release:${noShowLogId}`)  ← cancel by jobId
   ─→ Emit 'noshow.dismissed'
```

### A.8.4. Luồng Recording start/stop (UC-REC-01)

```
[START]
Host ──[POST /api/v1/recordings/start]──> RecordingController
                                       │
                                       ▼
                              RecordingService.start()
                              - validate quyền
                              - validate camera available (heartbeat < 5 phút)
                              - check capacity: < 5 RUNNING sessions
                              - check meeting.recording_enabled + consent (BR-PRIV-01)
                              - INSERT recording_sessions (PENDING)
                              - INSERT audit_log (action='RECORDING_START')
                                       │
                                       ▼
                       BullMQ enqueue 'recording-start'
                       jobId = `record:${sessionId}` (idempotent)
                                       │
                                       ▼
                       Response 202 (sessionId) ngay
                                       ▼
                       ──────────────────────────────
                       (queue worker — Recording Worker process)
                                       │
                                       ▼
                              RecordingWorker
                              - đọc camera config (RTSP URL)
                              - spawn FFmpeg child với cgroup limit (256MB RAM)
                              - lưu (PID, sessionId, workerNodeId, startedAt) vào Redis
                                hash 'recording:active:{sessionId}'
                                TTL = duration cap + 1h
                              - update recording_sessions: RUNNING, ffmpeg_pid,
                                worker_node_id, heartbeat_at
                                       │
                                       ▼
                              Heartbeat loop: mỗi 30s
                              - UPDATE recording_sessions SET heartbeat_at=now()
                              - check FFmpeg process còn sống (kill -0)
                              - nếu chết: status=FAILED, alert WS
                                       │
                                       ▼
                              FFmpeg ghi file MP4
                              (trong /var/recordings/{sessionId}.mp4)

[STOP]
Host ──[POST /api/v1/recordings/{id}/stop]──> RecordingController
                                       │
                                       ▼
                       RecordingService.stop()
                       - validate quyền
                       - BullMQ enqueue 'recording-stop' jobId = `stop:${sessionId}`
                       - return 202
                                       ▼
                       RecordingWorker pick up:
                       - lookup từ Redis hash
                       - process.kill(PID, 'SIGTERM')
                       - đợi exit (timeout 15s) → SIGKILL nếu cần
                       - ffprobe → duration + size
                       - Upload MP4 → S3 (multipart upload)
                       - INSERT media_files với retention_until = now() + 90 days
                       - UPDATE recording_sessions: COMPLETED, ended_at
                       - DELETE Redis hash + file local
                       - Emit 'recording.completed'

[ORPHAN RECOVERY] — chạy khi Recording Worker khởi động
   - SELECT recording_sessions WHERE status=RUNNING
   - Với mỗi session:
     · check heartbeat_at < now() - 90s → mark INTERRUPTED
     · check FFmpeg PID còn sống không (nếu cùng worker_node_id)
     · nếu file partial vẫn tồn tại → vẫn upload với flag is_partial=true
```

---

## A.9. Cross-cutting Concerns

### A.9.1. Bảo mật

- **Authentication:** JWT access token (15 phút) + Refresh token (7 ngày) lưu DB với `jti` revocable.
- **Authorization:** RBAC + ABAC. Guard tầng controller. Decorator `@Roles` + `@RequiresPermission`. Check tài nguyên: chỉ host hoặc participant mới xem detail meeting.
- **Password:** bcrypt cost 12. Reset OTP 6 số hết hạn 10 phút, 1 lần dùng, rate limit 3 lần/15 phút/email.
- **Transport:** HTTPS only. CORS allowlist domain frontend.
- **Storage:** Recording, snapshot, face image dùng S3 SSE-S3. Signed URL TTL theo ADR-18 (xem §A.9.9).
- **Secret:** Mọi secret qua biến môi trường, không commit. Dev `.env`, demo dùng Docker secrets hoặc vault. Rotation định kỳ 90 ngày cho DB password + S3 key.
- **Audit:** Mọi thao tác sensitive ghi vào `audit_logs` với before/after JSON. Danh sách action cứng ở BR-AUDIT-01.
- **HMAC cho IoT ingestion:** Face Server callback ký HMAC-SHA256 với shared secret per-device. Reject request không có sig hoặc sig sai.

#### Refresh Token Revocation Flow *(NEW v2)*

Các trigger PHẢI revoke refresh token:

| Trigger | Action |
|---|---|
| User logout | Revoke jti của session đó (`revoked_reason='LOGOUT'`) |
| User đổi password (UC-AUTH-04) | Revoke **TẤT CẢ** refresh token của user (`revoked_reason='PASSWORD_CHANGED'`) |
| Admin khóa account (UC-ACC-04) | Revoke tất cả + lock account (`revoked_reason='ACCOUNT_LOCKED'`) |
| Admin reset password OTP cho user (UC-AUTH-03 hoàn thành) | Revoke tất cả (`revoked_reason='PASSWORD_RESET'`) |
| Detect suspicious activity (3+ failed access trong 1 phút) | Revoke tất cả + lock account |
| Token > 30 ngày tuổi dù chưa expire | Revoke + force re-login |

Implementation: column `password_changed_at` trên `users`. Khi validate refresh token, check `refresh_tokens.issued_at >= users.password_changed_at` — nếu sai, từ chối. Cách này tránh phải UPDATE N rows khi đổi pass.

### A.9.2. Error handling

- Global `ExceptionFilter` chuẩn hóa response: `{ error: {code, message, details, traceId} }`.
- Mọi error có code dạng `SMRMPTS.<module>.<reason>`: ví dụ `SMRMPTS.MEETING.CONFLICT_ROOM`, `SMRMPTS.IOT.DEVICE_OFFLINE`.
- `traceId` UUID tạo ở middleware, log mọi nơi, return cho FE để user copy khi báo lỗi.
- FE hiển thị message friendly map từ error code; fallback hiển thị traceId.

### A.9.3. Logging & Observability

- Winston structured JSON log, level: `error/warn/info/debug`.
- Mỗi log line có: `timestamp, level, message, traceId, userId, module`.
- Log file rotate hằng ngày, giữ 14 ngày. Đẩy lên Loki nếu có time.
- Tránh log: password, JWT token, OTP, face embedding, recording binary.
- Metric tối thiểu: API response time, error rate, queue length (BullMQ), failed jobs, FFmpeg process count, Redis memory.
- **Correlation ID** xuyên suốt: incoming request → service call → BullMQ job → log line đều có cùng `traceId`. BullMQ job data include `parentTraceId`.

### A.9.4. Real-time push (WebSocket)

- WebSocket namespace: `/ws/realtime` với JWT auth tại handshake.
- Room/topic: `room:{id}`, `meeting:{id}`, `user:{id}` — client subscribe theo nhu cầu.
- Event push: `occupancy.changed`, `attendance.recorded`, `recording.error`, `noshow.warning`.
- Fallback polling nếu WS disconnect quá 30s.
- **Heartbeat:** client ping mỗi 25s, server response pong. 2 lần miss → reconnect.

### A.9.5. Privacy & Compliance

Xem section Business Rules §B.5.5 cho chi tiết. Tóm tắt:

- Recording chỉ bật khi `meeting.recording_enabled = true` VÀ tất cả participant required đã consent (BR-PRIV-01).
- Recording lưu tối đa 90 ngày mặc định, sau đó auto-delete. Config được trong `system_configurations`.
- Endpoint admin để xóa toàn bộ dữ liệu liên quan đến 1 user (right to be forgotten): **anonymize** thay vì xóa cứng (BR-PRIV-02), giữ tham chiếu integrity.
- Face image gốc và embedding KHÔNG lưu trong hệ thống — chỉ Face Server vendor quản lý. Backend chỉ lưu `person_code` reference.

### A.9.6. ⚡ NEW Outbox Pattern — Full Design

Đây là cơ chế đảm bảo "side-effect bên ngoài (email, push, etc.) phải gắn liền với commit nghiệp vụ — không mất, không gửi 2 lần".

**Quy tắc cứng:**

1. Mọi side-effect mà *không thể rollback* (gửi email, gọi external API, push notification) phải đi qua `email_outbox` hoặc bảng outbox tương đương.
2. INSERT vào outbox phải nằm trong CÙNG transaction với nghiệp vụ.
3. Worker pick up outbox với `SELECT ... FOR UPDATE SKIP LOCKED` để 2 worker không lấy cùng row.
4. Mỗi outbox row có `idempotency_key UNIQUE` — vendor SMTP nhận message với key này 2 lần thì chỉ gửi 1.

**Schema chuẩn:**

```sql
CREATE TABLE email_outbox (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key VARCHAR(128) UNIQUE NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  template VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    -- PENDING | SENDING | SENT | RETRY | DEAD
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id UUID
);
CREATE INDEX ON email_outbox (status, next_retry_at)
  WHERE status IN ('PENDING','RETRY');
```

**Worker pseudo-code:**

```typescript
async function outboxWorkerTick() {
  await prisma.$transaction(async tx => {
    const row = await tx.$queryRaw`
      SELECT * FROM email_outbox
      WHERE status IN ('PENDING','RETRY')
        AND next_retry_at <= now()
      ORDER BY next_retry_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    if (!row) return;

    await tx.email_outbox.update({
      where: { id: row.id },
      data: { status: 'SENDING', attempts: row.attempts + 1 }
    });

    try {
      await mailer.send({
        to: row.recipient,
        template: row.template,
        data: row.payload_json,
        // Pass idempotency key xuống SMTP nếu provider support
        headers: { 'X-Idempotency-Key': row.idempotency_key }
      });
      await tx.email_outbox.update({
        where: { id: row.id },
        data: { status: 'SENT', sent_at: new Date() }
      });
    } catch (e) {
      const isFinal = row.attempts + 1 >= row.max_attempts;
      await tx.email_outbox.update({
        where: { id: row.id },
        data: {
          status: isFinal ? 'DEAD' : 'RETRY',
          last_error: String(e),
          next_retry_at: new Date(Date.now() +
            Math.min(2 ** row.attempts * 60_000, 30 * 60_000))  // exp backoff cap 30min
        }
      });
    }
  });
}
```

**Idempotency key strategy theo template:**

| Template | Key formula |
|---|---|
| `meeting_invite` | `invite:${meetingId}:${userId}` |
| `meeting_reminder` | `reminder:${occurrenceId}:${userId}` |
| `meeting_cancel` | `cancel:${meetingId}:${userId}:${cancelledAt.unix()}` |
| `no_show_warning` | `noshow:${noShowLogId}` |
| `password_otp` | `otp:${userId}:${createdAt.unix()}` |

**Dead Letter Queue (DLQ):** Row `status='DEAD'` không tự retry. Có endpoint admin `/admin/outbox/dead` xem và bấm "retry" để reset về RETRY.

### A.9.7. ⚡ NEW WebSocket Scaling Decision

**ADR-16 đã quyết:** 1 instance NestJS đủ cho NFR 200 concurrent. Tuy nhiên, để giảm cost migration sau, setup **Socket.IO Redis adapter ngay từ Sprint 1**:

```typescript
// websocket.gateway.ts
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
  adapter: createAdapter(pubClient, subClient), // ← key line
})
```

Khi cần scale ra 2+ instance sau capstone: chỉ cần deploy thêm container, load balancer (Caddy) phải bật **sticky session** cho path `/ws/*`, hoặc dùng `transports: ['websocket']` only (bỏ long-polling).

**Quy tắc broadcast:** mọi `server.to(room).emit(...)` phải đi qua adapter. Không gọi `socket.emit` trực tiếp lên socket khác (sẽ không cross-instance).

### A.9.8. ⚡ NEW Rate Limiting & Circuit Breaker (Ingestion endpoint)

Vendor Face Server / Camera Service có thể bug → spam event làm DB tắc. Bắt buộc có:

**1. Rate limit per device:**

```typescript
// Trên /api/v1/iot/face/verify
@UseGuards(DeviceRateLimitGuard)  // 100 req/min/device, ttl 60s, Redis-backed
```

Vượt limit → return `429` với `Retry-After: 60`. Lưu metric để alert.

**2. Circuit breaker theo device:**

```
Window: 1 phút
Threshold: 50% request fail HOẶC > 200 req/min
→ Mở circuit cho device đó trong 5 phút
→ Reject mọi event với 503 + alert WS đến System Admin
→ Half-open sau 5 phút, cho 10 req thử
```

**3. Backpressure cho Camera Service:**

Camera Service (Python) đẩy snapshot mỗi 30s. Nếu API trả 429 hoặc timeout, Camera Service:
- Bỏ snapshot đó (drop), không retry
- Log warning local
- Tiếp tục snapshot tiếp theo

Lý do: occupancy là eventual data; miss 1 snapshot không nghiêm trọng; queue lên sẽ làm tắc trầm trọng hơn.

### A.9.9. ⚡ NEW Signed URL Strategy cho Long Media (Recording playback)

**Vấn đề:** Recording 90 phút → user click play → URL TTL 15 phút → URL expire khi đang xem.

**Quyết định (ADR-18):**

```typescript
function buildPlaybackUrl(file: MediaFile) {
  const durationSec = file.duration_sec ?? 3600;
  // TTL = duration * 1.5 + 30 phút buffer, tối thiểu 1 giờ, tối đa 4 giờ
  const ttlSec = Math.min(
    Math.max(Math.ceil(durationSec * 1.5) + 1800, 3600),
    14400
  );
  return s3.getSignedUrl('getObject', {
    Bucket: 'recordings',
    Key: file.s3_key,
    Expires: ttlSec,
    ResponseContentDisposition: 'inline'
  });
}
```

**Mỗi lần user mở playback page → backend regenerate URL.** Không cache URL ở frontend localStorage.

**Audit:** mọi lần generate playback URL ghi `audit_logs` với `action='RECORDING_VIEW'`, `entity_id=mediaFileId`. Phân tích pattern để phát hiện abuse (1 user xem 50 recording trong 5 phút = bất thường).

**Tải file (download):** dùng URL TTL 5 phút riêng, `ResponseContentDisposition: 'attachment'`.

---

# Phần B — Use Case Catalog & Business Rules

## B.1. Khung ưu tiên MoSCoW

Để bảo vệ scope và delivery, mọi use case được phân loại theo MoSCoW. Cam kết với hội đồng và lecturer chỉ phần MUST và SHOULD; phần COULD chỉ làm khi còn thời gian; phần WON'T loại khỏi Report Final.

| Mức | Định nghĩa | Tỷ lệ effort | Cam kết |
|---|---|---|---|
| **MUST** | Không có thì hệ thống không demo được; là MVP cứng. | ~60% | Cam kết delivery; demo cuối Sprint 6 |
| **SHOULD** | Nên có để hệ thống đủ tròn trịa; hỗ trợ MUST. | ~25% | Cam kết delivery; demo cuối Sprint 7 |
| **COULD** | Có thêm thì tốt; là differentiator của project. | ~15% | Cố gắng; demo nếu có |
| **WON'T** | Defer hoàn toàn; ghi vào Future Work. | 0% | Không làm trong scope 4 tháng |

## B.2. Danh mục Use Case (đã gộp và sắp xếp lại)

Feature Table gốc có ~140 function. Sau khi gộp các CRUD operation tương tự thành 1 UC (ví dụ tất cả thao tác trên Account là 1 UC với nhiều flow), danh mục còn ~65 UC. Chi tiết:

### B.2.1. Authentication & Account (M1, M2)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-AUTH-01 | Đăng nhập hệ thống | Tất cả role | MUST | 1 |
| UC-AUTH-02 | Đăng xuất khỏi hệ thống | Tất cả role | MUST | 1 |
| UC-AUTH-03 | Đặt lại mật khẩu qua OTP email | Tất cả role | MUST | 1 |
| UC-AUTH-04 | Đổi mật khẩu (đã đăng nhập) | Tất cả role | SHOULD | 1 |
| UC-ACC-01 | Tạo tài khoản đơn lẻ | Business Admin | MUST | 1 |
| UC-ACC-02 | Import tài khoản từ Excel | Business Admin | COULD | 7 |
| UC-ACC-03 | Cập nhật thông tin tài khoản | Business Admin / chính user (giới hạn field) | MUST | 1 |
| UC-ACC-04 | Khóa/mở khóa tài khoản | Business Admin, System Admin | SHOULD | 1 |
| UC-ACC-05 | Phân quyền (gán role) | System Admin | MUST | 1 |
| UC-ACC-06 | Tìm kiếm / lọc tài khoản | Business Admin, System Admin | SHOULD | 1 |
| UC-ACC-07 | Xem chi tiết hồ sơ + lịch sử hoạt động | System Admin | SHOULD | 2 |
| UC-ACC-08 | Tạo / cập nhật phòng ban | Business Admin | MUST | 1 |
| UC-ACC-09 | Liên kết face data với user | Business Admin | MUST | 4 |
| **UC-ACC-10** *(NEW)* | Anonymize / data deletion request | Business Admin | SHOULD | 7 |

### B.2.2. Room & Equipment (M3)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-ROOM-01 | Tạo / cập nhật / xóa phòng họp | Business Admin | MUST | 2 |
| UC-ROOM-02 | Tìm kiếm / lọc phòng họp | Tất cả internal user | MUST | 2 |
| UC-ROOM-03 | Xem chi tiết phòng (real-time status) | Manager, Business Admin | MUST | 5 |
| **UC-ROOM-04** *(NEW)* | Cấu hình policy phê duyệt cho phòng | Business Admin | SHOULD | 2 |
| UC-EQ-01 | Đăng ký / cập nhật thiết bị | Business Admin | SHOULD | 2 |
| UC-EQ-02 | Cập nhật trạng thái lỗi thiết bị | Internal user, Business Admin | SHOULD | 2 |
| UC-EQ-03 | Phân bổ thiết bị vào phòng | Business Admin | SHOULD | 2 |
| UC-EQ-04 | Tìm kiếm kho thiết bị | Business Admin | COULD | 7 |

### B.2.3. Meeting & Scheduling (M4)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-MTG-01 | Tạo cuộc họp one-time | Employee, Manager | MUST | 3 |
| UC-MTG-02 | Cập nhật thời gian / phòng họp | Host | MUST | 3 |
| UC-MTG-03 | Hủy cuộc họp | Host | MUST | 3 |
| UC-MTG-04 | Quản lý participant (thêm/gỡ thủ công) | Host | MUST | 3 |
| UC-MTG-05 | Import participant từ Excel | Host | COULD | 7 |
| UC-MTG-06 | Tra cứu lịch trình cá nhân | Tất cả internal user | MUST | 3 |
| UC-MTG-07 | Tạo / chỉnh sửa Agenda cuộc họp | Host | SHOULD | 3 |
| UC-MTG-08 | Đặt phòng họp đột xuất (ad-hoc) | Employee, Business Admin | SHOULD | 4 |
| UC-MTG-09 | Cấu hình tính năng ghi hình cho meeting | Host | MUST (cho recording) | 6 |
| UC-MTG-10 | Tạo chuỗi họp định kỳ (recurring) | Manager, Approver | WON'T | - |
| **UC-MTG-11** *(NEW)* | Xử lý meeting quá giờ (overrun) | System (auto) | SHOULD | 5 |
| UC-SCH-01 | Phát hiện conflict phòng/người tự động | System | MUST | 3 |
| UC-SCH-02 | Gợi ý phòng khả dụng | Employee | SHOULD | 3 |
| UC-SCH-03 | Gợi ý khung giờ tối ưu | Employee | COULD | 7 |
| UC-SCH-04 | Phê duyệt / từ chối yêu cầu đặt phòng | Approver | SHOULD | 3 |

### B.2.4. IoT Device & Attendance & Occupancy (M6, M7, M8)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-IOT-01 | Đăng ký thiết bị camera/IoT | System Admin | MUST | 3 |
| UC-IOT-02 | Cấu hình Face Server callback | System Admin | MUST | 3 |
| UC-IOT-03 | Cấu hình RTSP cho IP Camera | System Admin | MUST | 3 |
| UC-IOT-04 | Nhận heartbeat & cập nhật trạng thái thiết bị | System (auto) | MUST | 3 |
| UC-IOT-05 | Lưu raw event + chuẩn hóa payload | System (auto) | MUST | 4 |
| UC-IOT-06 | Xem danh sách thiết bị + sức khỏe | System Admin | SHOULD | 4 |
| UC-ATT-01 | Tự động tạo attendance từ Face verify event | System (auto) | MUST | 4 |
| UC-ATT-02 | Tạo bản ghi điểm danh thủ công (fallback) | Host, Business Admin | SHOULD | 4 |
| UC-ATT-03 | Chỉnh sửa / hủy hiệu lực attendance | Business Admin | SHOULD | 4 |
| UC-ATT-04 | Xem danh sách điểm danh cuộc họp | Host, Participant, Admin | MUST | 4 |
| UC-ATT-05 | Xem lịch sử vào/ra cá nhân + tổng thời gian | Host, Business Admin | SHOULD | 5 |
| UC-ATT-06 | Phát hiện & cảnh báo khuôn mặt lạ | System (auto) | SHOULD | 4 |
| UC-ATT-07 | Cảnh báo người chưa check-in sau giờ bắt đầu | System (auto) | SHOULD | 5 |
| UC-ATT-08 | Tracking vào/ra cá nhân bằng 2 IP camera | System (auto) | WON'T | - |
| UC-OCC-01 | Nhận event occupancy từ Camera Service | System (auto) | MUST | 5 |
| UC-OCC-02 | Cập nhật trạng thái phòng real-time | System (auto) | MUST | 5 |
| UC-OCC-03 | Dashboard real-time room status | Manager, Business Admin | MUST | 5 |

### B.2.5. No-show & Room Utilization (M9)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-NS-01 | Tự động phát hiện no-show | System (auto) | MUST | 5 |
| UC-NS-02 | Gửi cảnh báo no-show cho Host | System (auto) | MUST | 5 |
| UC-NS-03 | Tự động giải phóng phòng sau threshold | System (auto) | MUST | 5 |
| UC-NS-04 | Giải phóng phòng thủ công | Business Admin | SHOULD | 5 |
| UC-NS-05 | Xem danh sách phòng đang no-show | Manager, Business Admin | SHOULD | 5 |
| UC-NS-06 | Cấu hình ngưỡng no-show / early vacancy | System Admin | SHOULD | 5 |
| UC-NS-07 | Phát hiện phòng trống sớm (early vacancy) | System (auto) | COULD | 7 |
| UC-NS-08 | Xuất báo cáo sử dụng phòng | Business Admin | SHOULD | 6 |

### B.2.6. In-Meeting (M4 extension)

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-IM-01 | Bắt đầu / kết thúc phiên họp | Host | MUST | 5 |
| UC-IM-02 | Xem timeline cuộc họp | Host, Participant | SHOULD | 5 |
| UC-IM-03 | Xem danh sách người đang có mặt | Host, Business Admin | MUST | 5 |
| UC-IM-04 | Cảnh báo thời gian còn lại | System (auto) | SHOULD | 5 |
| UC-IM-05 | Yêu cầu / duyệt gia hạn phiên họp | Host, Approver | COULD | 7 |
| UC-IM-06 | Ghi chú trong cuộc họp (in-meeting notes) | Host | COULD | 7 |

### B.2.7. Recording, Transcript, Minutes

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-REC-01 | Start / stop recording 1 IP camera | Host | MUST | 6 |
| UC-REC-02 | Pause / resume recording | Host | WON'T | - |
| UC-REC-03 | Quản lý metadata media file | System (auto) | MUST | 6 |
| UC-REC-04 | Phát lại recording (signed URL) | Host, Participant | MUST | 6 |
| UC-REC-05 | Xem danh sách recording | Host, Business Admin | MUST | 6 |
| UC-REC-06 | Xóa / ẩn recording | Business Admin | SHOULD | 6 |
| UC-REC-07 | Thông báo lỗi recording real-time | System (auto) | SHOULD | 6 |
| UC-REC-08 | Ghi âm multi-channel theo seat | System (auto) | WON'T | - |
| **UC-REC-09** *(NEW)* | Recovery orphan recording session sau crash | System (auto) | MUST | 6 |
| UC-TRS-01 | Chuyển audio recording sang transcript (single-channel) | System (auto) | COULD | 7 |
| UC-TRS-02 | Xem transcript theo timeline | Host, Participant | COULD | 7 |
| UC-TRS-03 | Chỉnh sửa transcript thủ công | Host, Admin | WON'T | - |
| UC-MIN-01 | Tạo / chỉnh sửa minutes nháp | Host | COULD | 7 |
| UC-MIN-02 | Ban hành (publish) minutes | Host, Admin | COULD | 7 |
| UC-MIN-03 | Đính kèm file vào minutes | Host | COULD | 7 |
| UC-MIN-04 | Xuất minutes ra PDF / Word | Host, Admin | WON'T | - |

### B.2.8. Notification & Analytics & Config

| UC ID | Tên Use Case | Actor | MoSCoW | Sprint |
|---|---|---|---|---|
| UC-NOTI-01 | Gửi email mời họp tự động | System (auto) | MUST | 4 |
| UC-NOTI-02 | Gửi email nhắc lịch họp | System (auto) | MUST | 4 |
| UC-NOTI-03 | Gửi email hủy / đổi cuộc họp | System (auto) | MUST | 4 |
| UC-NOTI-04 | Push notification real-time qua WebSocket | System (auto) | SHOULD | 5 |
| UC-NOTI-05 | Phân phối minutes qua email | System (auto) | COULD | 7 |
| UC-RPT-01 | Dashboard tổng quan hệ thống | Manager, Admin | MUST | 6 |
| UC-RPT-02 | Dashboard sử dụng phòng | Manager, Admin | MUST | 6 |
| UC-RPT-03 | Dashboard điểm danh & hiện diện | Manager, Admin | MUST | 6 |
| UC-RPT-04 | Thống kê tỷ lệ no-show theo phòng | Manager, Admin | SHOULD | 6 |
| UC-RPT-05 | Xuất báo cáo PDF / Excel | Manager, Admin | SHOULD | 7 |
| UC-CFG-01 | Cấu hình hệ thống (threshold, policy) | System Admin | MUST | 5 |
| UC-CFG-02 | Xem audit log hoạt động hệ thống | System Admin | SHOULD | 7 |

### B.3. Thống kê use case theo mức độ ưu tiên

| MoSCoW | Số lượng UC | Diễn giải |
|---|---|---|
| **MUST** | 32 | Phải có; là MVP cứng — ~60% effort |
| **SHOULD** | 20 | Nên có — ~25% effort |
| **COULD** | 11 | Có thêm thì tốt — ~15% effort |
| **WON'T** | 6 | Loại khỏi scope 4 tháng |
| **TỔNG** | **69 UC** | |

So với ~140 function trong Feature Table ban đầu, sau khi gộp CRUD và áp MoSCoW, scope thực tế còn 32 MUST + 20 SHOULD = 52 UC bắt buộc. Đây là khối lượng phù hợp với team 6 dev × 4 tháng (~7-8 UC/sprint).

## B.4. Use Case chi tiết (10 UC critical) — với Acceptance Criteria Gherkin *(NEW v2)*

Để cân đối với khối lượng tài liệu, ở đây chỉ trình bày chi tiết 10 UC có rủi ro kỹ thuật cao nhất hoặc tác động lan tỏa lớn. **Mỗi UC bổ sung phần Acceptance Criteria dạng Gherkin** để QA và dev có cùng cách hiểu "done".

### UC-MTG-01: Tạo cuộc họp one-time

| Trường | Nội dung |
|---|---|
| UC ID & Name | UC-MTG-01 — Tạo cuộc họp one-time |
| Primary Actor | Internal Employee (Host), Manager |
| Description | Host tạo một cuộc họp mới với đầy đủ thông tin: tiêu đề, thời gian, phòng, danh sách participant, agenda (tùy chọn), và cấu hình ghi hình. |
| Trigger | User nhấn "Tạo cuộc họp" từ Calendar/Dashboard. |
| Precondition | PRE-1: User đã đăng nhập và có permission `MEETING_CREATE`. PRE-2: Tồn tại ít nhất 1 phòng họp ACTIVE và 1 user có thể được mời. |
| Postcondition | POST-1: Meeting + MeetingOccurrence + RoomBookingUsage + Participants được tạo trong cùng transaction. POST-2: Domain event `meeting.created` phát ra; email invite vào outbox. POST-3: Trạng thái meeting = SCHEDULED (hoặc PENDING_APPROVAL nếu phòng yêu cầu duyệt — xem BR-BOOK-01). |
| Normal Flow | 1. User mở form "Tạo cuộc họp". 2. User nhập title, scheduled_start, scheduled_end, chọn room, chọn participants (multi-select), agenda (optional), recording_enabled. 3. User nhấn "Tạo". 4. FE validate client-side (required fields, end > start, không quá khứ). 5. FE gọi POST /api/v1/meetings với DTO. 6. BE Guard kiểm JWT + permission + rate limit. 7. BE DTO validate. 8. SchedulingService.evaluateApproval(room) — xem BR-BOOK-01. 9. BEGIN TRANSACTION. 10. Tạo meeting record. 11. Tạo meeting_occurrence record. 12. INSERT room_booking_usages → nếu exclude constraint throw 23P01 → rollback → AF1. 13. Bulk insert meeting_participants. 14. Nếu có agenda: insert agendas. 15. Nếu phòng requires_approval: insert booking_approvals (status PENDING). 16. INSERT email_outbox cho từng participant (cùng TX). 17. COMMIT. 18. EventEmitter emit 'meeting.created'. 19. Return 201 + meeting object. |
| Alternative Flow | **AF1 (Conflict phòng):** Bước 12 phát hiện conflict → BE return 409 với detail `{conflictType:'ROOM', conflictMeetingId, conflictTitle}`. FE hiển thị "Phòng đã được đặt trong khung giờ này" + gợi ý phòng khác. **AF2 (Conflict người - non-blocking):** Bước 12 OK nhưng phát hiện participant trùng lịch ở cuộc họp OPTIONAL → return 201 + warnings[]. **AF3 (Cần approval):** Bước 15 → status=PENDING_APPROVAL, email invite chưa gửi cho participant, email gửi cho Approver. |
| Exception | EX1: Permission denied → 403 + `SMRMPTS.AUTH.PERMISSION_DENIED`. EX2: Time invalid → 400. EX3: Room/User không tồn tại → 404. EX4: Email service down → vẫn return 201, outbox lo retry. |
| Business Rule | BR-MTG-01: Meeting tối thiểu 15 phút, tối đa 8 giờ. BR-MTG-02: Số participant ≤ capacity phòng (warning nếu vượt, không block). BR-MTG-03: Host tự động là participant role HOST. BR-BOOK-01: Approval theo room policy. |
| Frequency | Cao — ước tính ~100 lần/ngày khi production. |
| Priority | MUST — Critical path |
| Non-functional | p95 < 800ms (bao gồm conflict check). |

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: Tạo cuộc họp one-time

  Background:
    Given user Alice có role EMPLOYEE và permission MEETING_CREATE
    And phòng "P101" ACTIVE với capacity 10, requires_approval=false
    And user Bob là EMPLOYEE active

  Scenario: Happy path - tạo meeting thành công
    Given không có booking nào ở "P101" lúc 14:00-15:00 ngày mai
    When Alice POST /api/v1/meetings với
      | title           | "Team sync"        |
      | room            | P101               |
      | start           | tomorrow 14:00     |
      | end             | tomorrow 15:00     |
      | participants    | [Bob]              |
    Then response status 201
    And meeting status = "SCHEDULED"
    And tồn tại 1 row room_booking_usages cho P101
    And email_outbox có 2 row (invite Alice + invite Bob)
    And event "meeting.created" được emit

  Scenario: Conflict phòng - exclusive
    Given đã có meeting "Existing" ở P101 lúc 14:30-15:30 ngày mai
    When Alice POST với time 14:00-15:00 ngày mai và room=P101
    Then response status 409
    And error.code = "SMRMPTS.MEETING.CONFLICT_ROOM"
    And error.details.conflictMeetingId tồn tại
    And KHÔNG có row mới nào trong meetings, occurrences, booking_usages

  Scenario: Race condition - 2 user đặt cùng phòng cùng giờ
    Given Alice và Carol cùng submit request đặt P101 lúc 14:00-15:00 ngày mai trong cùng 100ms
    When cả hai request được xử lý đồng thời
    Then chính xác 1 request thành công (201)
    And request còn lại trả 409 SMRMPTS.MEETING.CONFLICT_ROOM
    And chỉ có 1 row trong room_booking_usages

  Scenario: Phòng yêu cầu approval
    Given phòng P-VIP có requires_approval=true với approver=Manager Dave
    When Alice tạo meeting ở P-VIP
    Then meeting status = "PENDING_APPROVAL"
    And booking_approvals có 1 row PENDING với approver_id=Dave
    And email_outbox CHỈ có email gửi Dave (chưa gửi participant)

  Scenario: Validate quá khứ
    When Alice POST với start=yesterday 14:00
    Then response status 400
    And error.details có field "start" với message chứa "không thể trong quá khứ"

  Scenario: Validate độ dài
    When Alice POST với start=14:00, end=14:10 (10 phút)
    Then response status 400
    And error.code chứa "BR-MTG-01"

  Scenario: Số participant vượt capacity - warning chứ không block
    Given P101 capacity = 10
    When Alice POST với 15 participants
    Then response status 201
    And response.warnings có entry "capacity_exceeded"
```

### UC-ATT-01: Tự động tạo attendance từ Face verify event

| Trường | Nội dung |
|---|---|
| UC ID & Name | UC-ATT-01 — Auto-create attendance từ Face Server event |
| Primary Actor | System (automated) — trigger từ Face Server callback |
| Description | Khi Face Server tại Door Terminal nhận diện thành công 1 person, backend nhận event, map person_code → user, tra cứu meeting đang diễn ra ở phòng, tạo/cập nhật attendance record. |
| Trigger | POST từ Face Server tới `/api/v1/iot/face/verify` (callback URL đã cấu hình). |
| Precondition | PRE-1: Device đã được đăng ký và assign vào 1 phòng. PRE-2: Tồn tại device_user_mapping cho person_code này (nếu không → tạo unknown face log). PRE-3: Có meeting_occurrence ACTIVE hoặc SCHEDULED trong khoảng `[scheduled_start - 15min, scheduled_end + 15min]` tại phòng đó. |
| Postcondition | POST-1: `iot_device_events` lưu raw payload ngay. POST-2: `AttendanceRecord` được tạo/cập nhật. POST-3: WebSocket push `attendance.recorded` tới room channel. |
| Normal Flow | 1. Face Server POST event { device_code, person_code, person_name, captured_at, confidence, image_url } + HMAC signature. 2. IngestionController verify signature + rate limit + circuit breaker. 3. IoTService.saveRawEvent() — lưu `iot_device_events` ngay, processed=false, idempotency_key. 4. Return 200 OK ngay (target < 200ms). 5. BullMQ enqueue 'face-event' với jobId=idempotency_key (dedupe). 6. Worker pick up event. 7. Normalize payload theo event_schema_version. 8. DeviceUserMappingService.findUserByPersonCode(). 9. Nếu không tìm thấy → tạo `unknown_face_events` + emit alert. END. 10. AttendanceService.findActiveMeetingForRoom(room_id, captured_at). 11. Nếu không có meeting active → log info, skip. END. 12. AttendanceService.upsertAttendance(occurrence_id, user_id, captured_at). 13. Tạo `attendance_events` type=CHECK_IN với idempotency_key. 14. Update `iot_device_events.processed=true`. 15. Emit 'attendance.recorded'. 16. WS gateway push tới `room:{room_id}`. |
| Alternative Flow | AF1: Person code không có trong mapping → unknown face log + alert. AF2: Person check-in 2 lần trong < 30s → dedupe qua idempotency_key, skip lần 2. AF3: Confidence < 0.7 → vẫn ghi nhưng `source='LOW_CONFIDENCE_FACE'`. |
| Exception | EX1: Signature invalid → 401 + log security warning. EX2: Device không tồn tại → 404. EX3: Rate limit/circuit open → 429/503. EX4: DB transaction fail → retain trong `iot_device_events`, worker retry exp backoff tối đa 3 lần → DLQ. |
| Business Rule | BR-ATT-01: Window matching meeting `[scheduled_start - 15min, scheduled_end + 15min]`. BR-ATT-02: Nếu là check-in đầu tiên VÀ host check-in → auto-set `actual_start = captured_at`. BR-ATT-03: `confidence < 0.7` → mark cần admin review. |
| Frequency | Rất cao — ước tính 500-2000 event/ngày. |
| Priority | MUST — Là tính năng đặc trưng quyết định project |
| Non-functional | Ingestion p95 < 200ms (chỉ lưu raw). End-to-end (event → UI presence) p95 < 3s. |

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: Auto-create attendance từ face verify event

  Background:
    Given device "DOOR-P101" đã đăng ký, assign room=P101, có HMAC secret
    And user Alice có device_user_mapping với person_code="EMP001" trên DOOR-P101
    And meeting M1 ở P101 scheduled 14:00-15:00 hôm nay, Alice là participant
    And hiện tại là 14:05

  Scenario: Happy path - check-in lần đầu
    When Face Server POST verify event { device=DOOR-P101, person_code=EMP001, captured_at=14:05, confidence=0.95 } với HMAC hợp lệ
    Then response 200 trong < 200ms
    And iot_device_events có 1 row với processed=false
    And [async sau < 3s] attendance_records cho (M1, Alice) tồn tại với status=PRESENT
    And attendance_events có 1 row type=CHECK_IN, idempotency_key duy nhất
    And WebSocket subscriber của room:P101 nhận event "attendance.recorded"

  Scenario: Duplicate event - cùng person, cùng device, cùng captured_at
    Given attendance Alice đã được ghi từ event trước
    When Face Server gửi LẠI event y hệt (cùng idempotency_key)
    Then response 200
    And iot_device_events vẫn 1 row (không tạo thêm)
    And attendance_events vẫn 1 row (UNIQUE idempotency_key chặn)

  Scenario: HMAC signature sai
    When Face Server POST với HMAC không khớp shared secret
    Then response 401
    And không có row mới trong iot_device_events
    And security log có entry "INVALID_HMAC"

  Scenario: Rate limit vượt ngưỡng
    Given device DOOR-P101 đã gửi 100 event trong 1 phút qua
    When event thứ 101 đến trong cùng phút
    Then response 429 với header Retry-After: 60

  Scenario: Unknown person
    When Face Server POST với person_code="STRANGER001" (không có mapping)
    Then response 200 (ingestion vẫn OK)
    And [async] unknown_face_events có 1 row
    And WS subscriber của business admin nhận alert "unknown.face"
    And attendance_records KHÔNG có row mới

  Scenario: Check-in ngoài window meeting
    Given Alice check-in lúc 13:30 (sớm hơn 30 phút so với start 14:00)
    When event được xử lý
    Then attendance_records KHÔNG có row mới
    And log info "Face verify outside any meeting window"

  Scenario: Low confidence
    When event với confidence = 0.6
    Then attendance_records có row với source="LOW_CONFIDENCE_FACE"
    And cần admin review (flag riêng)

  Scenario: Host check-in lần đầu → auto-set actual_start
    Given M1 actual_start IS NULL
    And Alice là host của M1
    When Alice check-in lúc 14:05
    Then meeting_occurrences.actual_start = 14:05 cho M1
```

### UC-NS-01: Tự động phát hiện no-show

| Trường | Nội dung |
|---|---|
| UC ID & Name | UC-NS-01 — Auto-detect no-show |
| Primary Actor | System (BullMQ scheduler) |
| Description | Hệ thống định kỳ quét các meeting_occurrence có scheduled_start đã qua nhưng chưa có actual_start và phòng không có ai → tạo no_show_log. |
| Trigger | BullMQ repeating job 'no-show-check' chạy mỗi 60 giây. |
| Precondition | PRE-1: Có ít nhất 1 meeting_occurrence trong trạng thái SCHEDULED. PRE-2: System config `no_show_threshold_minutes` đã set (default 10). |
| Postcondition | POST-1: `no_show_logs` entry được tạo cho mỗi occurrence vi phạm. POST-2: Email warning đã enqueue (qua outbox). POST-3: BullMQ delayed job 'auto-release' enqueue với jobId deterministic. |
| Normal Flow | (xem §A.8.3 sequence diagram) |
| Alternative Flow | AF1 Host dismiss → remove BullMQ job theo jobId. AF2 Manual release trước → status MANUAL_RELEASED, cancel auto-release. |
| Exception | EX1 OccupancyService timeout → coi như chưa có signal, vẫn tạo no_show_log (false positive sẽ dismiss thủ công). |
| Business Rule | Xem **BR-NS-01, BR-NS-02, BR-NS-03**. |
| Frequency | Job chạy mỗi phút; ~5-20 occurrence/giờ peak. |
| Priority | MUST |
| Non-functional | Job phải hoàn thành < 30s/lần chạy với 200 occurrence pending. |

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: Auto-detect no-show & auto-release

  Background:
    Given system_config no_show_threshold_minutes = 10
    And system_config no_show_grace_minutes = 5
    And meeting M1 ở P101 scheduled 14:00-15:00 hôm nay, host=Alice

  Scenario: Phòng trống quá threshold → tạo no-show log
    Given hiện tại là 14:11 (quá 10 phút)
    And M1.actual_start IS NULL
    And không có occupancy snapshot trong 5 phút gần nhất với is_occupied=true cho P101
    When NoShowCheckJob chạy
    Then no_show_logs có 1 row với (booking_usage_id của M1, status=DETECTED)
    And email_outbox có 1 row template=no_show_warning, recipient=Alice
    And BullMQ có job 'auto-release' với jobId="auto-release:{logId}" delay 5 phút

  Scenario: Phòng có người → KHÔNG tạo no-show
    Given hiện tại là 14:11
    And occupancy snapshot lúc 14:09 có is_occupied=true
    When NoShowCheckJob chạy
    Then no_show_logs KHÔNG có row mới cho M1

  Scenario: Host dismiss → cancel auto-release
    Given no_show_logs đã có row id=42 status=DETECTED
    And BullMQ job "auto-release:42" đang chờ
    When Alice POST /api/v1/no-show/42/dismiss
    Then no_show_logs.status = DISMISSED
    And BullMQ.getJob("auto-release:42") trả null (đã remove)
    And không có booking nào bị release

  Scenario: Auto-release sau grace period
    Given no_show_log id=42 status=DETECTED tạo lúc 14:11
    And BullMQ job "auto-release:42" đến hạn lúc 14:16
    When job chạy
    Then re-check no_show_logs.status (vẫn DETECTED, không DISMISSED)
    And re-check occupancy (vẫn trống)
    And room_booking_usages.usage_status = AUTO_RELEASED
    And event "room.released" emit
    And WS push tới subscriber của P101

  Scenario: Auto-release nhưng phòng đã có người
    Given job auto-release đến hạn
    But có occupancy snapshot 1 phút trước is_occupied=true
    When job chạy
    Then booking KHÔNG release
    And no_show_logs.status = ARRIVED_LATE
    And log info "no-show resolved by late arrival"

  Scenario: Meeting bị cancel trong lúc đợi auto-release
    Given no_show_log id=42, job đang chờ
    When meeting M1 bị cancel (UC-MTG-03)
    Then no_show_logs.status = CANCELLED
    And BullMQ job "auto-release:42" được remove
```

### UC-REC-01: Start / Stop recording 1 IP camera

| Trường | Nội dung |
|---|---|
| UC ID & Name | UC-REC-01 — Start/Stop Recording |
| Primary Actor | Meeting Host |
| Description | Host khởi động ghi hình từ IP camera đã assign cho phòng họp. Hệ thống spawn FFmpeg child process, ghi RTSP stream → MP4. Khi Host stop, FFmpeg kết thúc gọn, file upload S3. |
| Trigger | Host nhấn nút "Bắt đầu ghi hình" / "Dừng ghi hình" trong In-Meeting UI. |
| Precondition | PRE-1: Meeting đang IN_PROGRESS. PRE-2: Phòng có ít nhất 1 IP camera được assign và online (heartbeat trong 5 phút). PRE-3: `meeting.recording_enabled = true` HOẶC Host có role `MEETING_RECORDING_OVERRIDE`. **PRE-4 *(NEW)*: Tất cả participant required đã consent (BR-PRIV-01).** |
| Postcondition (start) | POST-1: `recording_sessions` record được tạo status=PENDING → RUNNING. POST-2: BullMQ enqueue 'recording-start' job. POST-3: audit_log entry. |
| Postcondition (stop) | POST-1: FFmpeg đã exit gracefully. POST-2: `media_files` record được tạo với s3_key. POST-3: `recording_sessions.status=COMPLETED`. |
| Normal Flow | (xem §A.8.4) |
| Alternative Flow | AF1 (Auto-stop khi meeting end): Khi `EndMeetingService` chạy mà session đang RUNNING → tự động trigger stop flow. AF2 (Worker crash): orphan recovery (xem UC-REC-09). |
| Exception | EX1 Camera offline → 409. EX2 FFmpeg không khởi động được → status=FAILED. EX3 Upload S3 fail → retry exp backoff 3 lần → mark FAILED nhưng giữ file local. EX4 SIGTERM không exit → SIGKILL sau 15s, mark INTERRUPTED. |
| Business Rule | **BR-REC-01**: Tối đa 5 session RUNNING cùng lúc. **BR-REC-02**: File MP4 tối đa 4GB; meeting > 4h → segment Phase 2. **BR-REC-03**: Auto-delete sau 90 ngày (config). **BR-PRIV-01**: Consent flow. |
| Frequency | Trung bình — 5-20 recording/ngày. |
| Priority | MUST |
| Non-functional | Start latency < 5s. Stop + upload latency < 30s cho file 500MB. |

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: Start/Stop recording

  Background:
    Given meeting M1 đang IN_PROGRESS, recording_enabled=true
    And camera CAM-P101 online (heartbeat 1 phút trước)
    And tất cả participant required đã consent

  Scenario: Happy path start
    When Host Alice POST /api/v1/recordings/start { occurrence_id=M1, camera_device_id=CAM-P101 }
    Then response status 202 với { sessionId } trong < 5s
    And recording_sessions có row status=PENDING (→ RUNNING trong 5s)
    And BullMQ có job "record:{sessionId}"
    And audit_logs có entry action=RECORDING_START actor=Alice
    And [sau 10s] file /var/recordings/{sessionId}.mp4 tồn tại và đang tăng size

  Scenario: Capacity limit
    Given đã có 5 recording_sessions với status=RUNNING
    When Host start session thứ 6
    Then response 429 với error.code = "SMRMPTS.RECORDING.CAPACITY_EXCEEDED"

  Scenario: Camera offline
    Given camera CAM-P101 last_seen_at = 10 phút trước
    When Host start recording
    Then response 409 với error.code = "SMRMPTS.IOT.DEVICE_OFFLINE"

  Scenario: Thiếu consent
    Given participant Bob là required nhưng consent_recording=false
    When Host start recording
    Then response 403 với error.code = "SMRMPTS.RECORDING.CONSENT_MISSING"
    And error.details có danh sách user chưa consent

  Scenario: Happy path stop
    Given recording session id=S1 status=RUNNING với FFmpeg PID 12345
    When Host POST /api/v1/recordings/S1/stop
    Then response 202
    And [trong 30s] FFmpeg process 12345 exit gracefully
    And file MP4 upload lên S3 thành công
    And media_files có row mới với retention_until = now + 90 days
    And recording_sessions.status = COMPLETED
    And event "recording.completed" emit
    And /var/recordings/{S1}.mp4 đã xóa

  Scenario: FFmpeg không phản hồi SIGTERM
    Given FFmpeg process bị treo
    When stop được gọi
    Then sau 15s timeout, SIGKILL được gửi
    And recording_sessions.status = INTERRUPTED
    And file partial vẫn được upload nếu size > 0
    And media_files.status = "PARTIAL"

  Scenario: Auto-stop khi meeting end
    Given recording session S1 đang RUNNING
    When meeting M1 được end (UC-IM-01)
    Then stop flow tự trigger
    And recording_sessions.status = COMPLETED

  Scenario: Recovery orphan sau worker restart (UC-REC-09)
    Given recording_sessions.S1 status=RUNNING nhưng heartbeat_at = 5 phút trước
    When Recording Worker khởi động lại
    Then S1.status = INTERRUPTED
    And nếu file partial tồn tại → upload với is_partial=true
    And event "recording.interrupted" emit
```

### UC-OCC-02: Cập nhật trạng thái phòng real-time

| Trường | Nội dung |
|---|---|
| UC ID & Name | UC-OCC-02 — Real-time Room Occupancy Update |
| Primary Actor | System (Camera Service push) |
| Description | Camera Service đọc RTSP từ IP camera, detect motion + person presence; mỗi 30s push 1 snapshot `{is_occupied, estimated_count}` tới backend. Backend cập nhật state + WebSocket push. |
| Trigger | Camera Service POST `/api/v1/iot/occupancy/snapshot` mỗi 30s/camera. |
| Precondition | PRE-1: Camera Service đang chạy và kết nối được RTSP. PRE-2: Camera được assign cho 1 room. |
| Postcondition | POST-1: `room_occupancy_snapshots` có entry mới. POST-2: Redis cache cập nhật. POST-3: WebSocket push tới `room:{id}` subscribers nếu state thay đổi. |
| Normal Flow | 1. Camera Service capture frame mỗi 5s, batch 30s/snapshot tổng hợp. 2. POST với HMAC sig + rate limit. 3. BE Auth + circuit breaker check. 4. Save raw event `iot_device_events`. 5. Save `room_occupancy_snapshots`. 6. Update Redis 'room:{id}:occupancy' TTL 5 phút. 7. Emit 'occupancy.changed' nếu state thay đổi. 8. WS push qua adapter. |
| Alternative Flow | AF1 (Loss of signal): 3 snapshot liên tiếp miss → camera 'no_signal' alert. AF2 (No state change): vẫn lưu nhưng không push WS. AF3 (Backpressure): API trả 429 → Camera Service drop snapshot, log warning, KHÔNG retry. |
| Exception | EX1 Token invalid → 401. EX2 Rate limit → 429 (Camera Service drop). EX3 DB write fail → 500. |
| Business Rule | BR-OCC-01: Snapshot rate 30s default, configurable. BR-OCC-02: `estimated_count` chỉ là heuristic — không dùng chấm công cá nhân. BR-OCC-03: state "occupied" = is_occupied=true HOẶC estimated_count > 0 trong snapshot < 5 phút. |
| Frequency | Rất cao: 50 phòng × 1 snapshot/30s = 144,000/ngày. |
| Priority | MUST |
| Non-functional | Endpoint p95 < 200ms. WebSocket latency < 1s. |

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: Real-time room occupancy

  Background:
    Given camera CAM-P101 assign room=P101
    And FE user Manager đang subscribe WS topic "room:P101"

  Scenario: Snapshot có người - state change
    Given snapshot trước is_occupied=false
    When Camera Service POST { device=CAM-P101, captured_at=now, is_occupied=true, estimated_count=3, confidence=0.85 }
    Then response 200 trong < 200ms
    And room_occupancy_snapshots có row mới
    And Redis "room:P101:occupancy" cập nhật với is_occupied=true
    And WS subscriber nhận event "occupancy.changed" với is_occupied=true trong < 1s

  Scenario: Snapshot không thay đổi state - không push WS
    Given snapshot trước is_occupied=true
    When snapshot mới cũng is_occupied=true
    Then row mới được save vào DB
    But WS không push event (giảm noise)

  Scenario: Backpressure - drop khi API chậm
    Given API đang trả 429 (rate limited)
    When Camera Service gửi snapshot
    Then Camera Service log warning "snapshot dropped"
    And KHÔNG retry snapshot này
    And tiếp tục snapshot 30s sau

  Scenario: Loss of signal - 3 snapshot liên tiếp miss
    Given Camera Service không thấy CAM-P101 trong 90s
    Then iot_devices.status của CAM-P101 = "NO_SIGNAL"
    And alert WS gửi tới System Admin
```

### Các UC critical khác (template tóm tắt)

5 UC còn lại trong nhóm critical sẽ được viết đầy đủ trong Report 2 với cùng template (table chi tiết + Gherkin). Ở đây tóm tắt key points:

- **UC-IOT-05 (Lưu raw event + chuẩn hóa payload):** Đặc biệt quan trọng vì là "cánh cửa" nhận mọi event vendor. Phải decouple ingestion (lưu raw) và processing (normalize + business). Lưu raw NGAY trước khi xử lý — rule cứng để debug và replay event sau. **event_schema_version** lưu để hỗ trợ vendor đổi format.

- **UC-SCH-01 (Conflict detection):** Đã xử lý bằng ADR-17 (exclude constraint GIST). KHÔNG dùng app-level lock. Test concurrency với JMeter/k6 100 request đồng thời cùng phòng cùng giờ → đúng 1 thành công.

- **UC-NOTI-01/02/03 (Email pipeline):** Outbox pattern theo §A.9.6. Idempotency key theo template. Worker poll + SKIP LOCKED. DLQ admin UI ở UC-CFG-02.

- **UC-IM-01 (Start/End session):** State machine rõ ràng: SCHEDULED → IN_PROGRESS → ENDED. Trigger nhiều side effect: stop recording, finalize attendance, tính total_minutes. End có thể manual hoặc auto khi quá `scheduled_end + overrun_grace` (BR-MTG-OVERRUN-01).

- **UC-RPT-01/02/03 (Dashboards):** Aggregate query nặng. Cache Redis 5-15 phút. Pre-compute hằng ngày qua BullMQ scheduled job nếu chậm. Read từ `room_occupancy_hourly` thay vì `room_occupancy_snapshots` để giảm tải.

## B.5. ⚡ NEW Business Rules Reference

Section này tách riêng các business rule không thuộc về 1 UC cụ thể mà cross-cutting hoặc quan trọng đến mức cần lock với lecturer trước khi code. **Mỗi BR có mã, mô tả, owner, và cờ "cần lecturer xác nhận".**

### B.5.1. Roles & Permissions

**BR-ROLE-01:** Phân biệt `Department Manager` (role nhân sự, gắn với phòng ban trong `user_departments.position`) và `Approver` (role kỹ thuật, có permission `BOOKING_APPROVE`). 1 user có thể giữ cả 2 hoặc chỉ 1. Khi UC đề cập "Manager", chỉ rõ là loại nào.

**BR-ROLE-02:** Permission system 2 lớp: `role.permissions` (broad) + `resource ownership check` (narrow). Vd: role HOST có permission `MEETING_EDIT`, nhưng chỉ edit được meeting `host_id = self.id`.

**BR-ROLE-03:** Cross-department booking — Employee phòng ban A có thể đặt phòng "thuộc" phòng ban B nếu phòng không có policy hạn chế. Phòng có `department_restricted=true` chỉ user cùng department mới đặt được.

### B.5.2. Booking Approval (cần lecturer xác nhận)

**BR-BOOK-01:** Khi nào meeting cần approval?

| Điều kiện | Approval cần thiết? | Approver |
|---|---|---|
| Phòng có `requires_approval=true` | ✅ Có | Theo `room.approver_strategy`: DEPT_MANAGER (manager của host) HOẶC ROOM_OWNER (cố định trong room) HOẶC FIXED_USER |
| Meeting > 4 giờ | ✅ Có | Department Manager của host |
| Meeting ngoài giờ hành chính (trước 8h, sau 18h, T7-CN) | ✅ Có | Department Manager |
| Tất cả các trường hợp khác | ❌ Không, auto-approve | N/A |

**BR-BOOK-02:** Approval timeout: nếu approver không quyết định trong 24h, meeting tự động bị reject + email báo host.

**BR-BOOK-03:** Approver có thể edit thời gian/phòng trước khi approve (counter-offer). Host phải accept counter-offer mới meeting thành SCHEDULED.

### B.5.3. No-show Definition (cần lecturer xác nhận)

**BR-NS-01:** Phòng được coi là "trống" khi:
- KHÔNG có occupancy snapshot trong 5 phút qua với `is_occupied=true`, VÀ
- KHÔNG có attendance check-in trong 5 phút qua

Tức cần BOTH camera AND face data đồng thuận. Lý do: camera có thể miss khi không có chuyển động (mọi người ngồi yên); face check-in có thể delay.

**BR-NS-02:** Host vắng nhưng có participant đến — đây có là no-show không?
- **Quy ước:** KHÔNG. Phòng "có người" → không tạo no_show_log. Nhưng có rule riêng `BR-NS-04` cảnh báo host vắng.

**BR-NS-03:** Default threshold = 10 phút sau `scheduled_start`. Grace period = 5 phút (giữa warning và auto-release). Cả hai config được trong `system_configurations`.

**BR-NS-04:** Nếu phòng có người trong threshold nhưng host (theo `meeting.host_id`) chưa check-in face → cảnh báo riêng "Host vắng" sau 15 phút (không release phòng).

### B.5.4. Meeting Overrun *(BR-MTG-OVERRUN-01 — NEW v2)*

**Vấn đề:** Meeting có thể kết thúc sau `scheduled_end`.

**BR-MTG-OVERRUN-01 (Overrun grace):**
- Auto-end meeting sau `scheduled_end + 10 phút` nếu Host chưa nhấn End. Lúc đó `actual_end` = `scheduled_end + actual_overrun`.
- Phòng KHÔNG bị release trước `scheduled_end` (BR-NS-01 vẫn áp dụng).
- Nếu có booking liền kề sau đó: 5 phút trước `scheduled_end`, push notification cho Host "có booking tiếp theo, vui lòng kết thúc đúng giờ".

**BR-MTG-OVERRUN-02 (Conflict do overrun):**
- Nếu meeting A overrun chồng lên meeting B (đã book sau): không cancel A, không cancel B. B chỉ start được khi A `actual_end` xảy ra. Hiển thị cảnh báo UI cho cả 2 host.

**BR-MTG-OVERRUN-03 (Early end):**
- Nếu Host end meeting sớm (UC-IM-01) → phòng release ngay nếu KHÔNG có booking liền kề trong 30 phút tới. Có booking liền kề → giữ reserved.

### B.5.5. Privacy & Consent *(BR-PRIV-*)*

**BR-PRIV-01 (Recording consent):**
- Khi Host bật `recording_enabled` cho meeting, email invite có checkbox "Tôi đồng ý cuộc họp này được ghi hình".
- Participant có thể đồng ý/từ chối qua link (no login required, signed token).
- Default trước khi quyết định: `consent_recording=null` (chưa quyết).
- **Required participant chưa consent = recording không được phép start** (UC-REC-01 PRE-4).
- Optional participant chưa consent: cảnh báo Host nhưng KHÔNG block.
- Người vắng mặt lúc gửi invite (thêm sau hoặc đến đột xuất): default `consent_recording=true` IF đã được thông báo qua email/banner trong phòng "phòng này đang ghi hình". Banner phải hiển thị trong UI in-meeting.

**BR-PRIV-02 (Right to be forgotten / Data anonymization):**

Khi user request xóa dữ liệu (UC-ACC-10):
- **KHÔNG xóa cứng `users` row** (vỡ FK).
- Anonymize: `email='deleted-{id}@anon'`, `full_name='Deleted User {id}'`, `phone=null`, `face_mapping` xóa cứng, `password_hash='!'`.
- `attendance_records` giữ nguyên user_id (counts vẫn đúng cho thống kê).
- `audit_logs` giữ nguyên actor_id (legal compliance).
- `meetings.host_id` giữ nguyên (history vẫn xem được, hiển thị "Deleted User").
- `recording_sessions` mà user là Host → recording vẫn giữ nhưng user mất quyền access.
- Lưu vào `data_deletion_requests` với `anonymized_entities_json`.

**BR-PRIV-03 (Face data location):**
- Face image gốc + embedding KHÔNG bao giờ lưu trong DB SMRMPTS.
- Chỉ Face Server vendor quản lý (ADR-19).
- Backend lưu `person_code` reference + `image_url` (link sang Face Server) trong `attendance_events.evidence_url`.
- Khi user request "xóa face": gọi API Face Server xóa person + xóa `device_user_mappings` row.

**BR-PRIV-04 (Recording retention):**
- Default 90 ngày. Config trong `system_configurations.recording_retention_days`.
- BullMQ scheduled job hằng ngày xóa media_files và S3 object có `retention_until <= now()`.
- Trước khi xóa: notification cho Host meeting đó 7 ngày trước "recording sẽ bị xóa, tải về nếu cần".

### B.5.6. Audit Trail *(BR-AUDIT-01)*

**BR-AUDIT-01: Danh sách action BẮT BUỘC ghi audit_logs:**

| Module | Actions |
|---|---|
| Auth | LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, PASSWORD_RESET, PASSWORD_CHANGE |
| Account | ACCOUNT_CREATE, ACCOUNT_UPDATE, ACCOUNT_LOCK, ACCOUNT_UNLOCK, ROLE_GRANT, ROLE_REVOKE |
| Meeting | MEETING_CREATE, MEETING_UPDATE, MEETING_CANCEL, MEETING_FORCE_END |
| Recording | RECORDING_START, RECORDING_STOP, RECORDING_VIEW, RECORDING_DOWNLOAD, RECORDING_DELETE |
| Privacy | DATA_DELETION_REQUEST, CONSENT_GRANT, CONSENT_REVOKE |
| System | CONFIG_CHANGE, DEVICE_REGISTER, DEVICE_REMOVE |
| No-show | NOSHOW_DISMISS, ROOM_MANUAL_RELEASE |

Mọi action khác (đọc thông thường, scroll dashboard) KHÔNG vào audit_logs để tránh phình.

### B.5.7. Tổng kết các BR cần lecturer xác nhận

| BR | Câu hỏi cho lecturer | Default đang giả định |
|---|---|---|
| BR-ROLE-01 | Manager vs Approver có phải 2 role tách biệt hay gộp 1? | Tách 2 |
| BR-BOOK-01 | Bảng matrix approval có hợp lý không? | Có (xem table) |
| BR-NS-01 | "Trống" là cả camera + face đồng thuận, hay chỉ 1 trong 2 đủ? | Cả 2 (AND) |
| BR-NS-02 | Host vắng nhưng participant đến — có phải no-show? | Không |
| BR-MTG-OVERRUN-01 | Auto-end sau scheduled_end bao lâu? | 10 phút |
| BR-PRIV-01 | Required participant từ chối → block recording? | Có (block) |
| BR-PRIV-02 | Anonymize thay vì xóa cứng — OK với PDPA VN? | OK |
| BR-PRIV-04 | Retention 90 ngày default — đủ chưa? | Đủ cho capstone |

---

# Phần C — Kế hoạch triển khai 4 tháng

## C.1. Cơ cấu team & phân vai

### C.1.1. Plan A — 6 dev (mở rộng team)

| Vai trò | Đề xuất người | Trách nhiệm chính | % code | % review/design |
|---|---|---|---|---|
| Tech Lead / Solution Architect | Hải (Leader) | Kiến trúc, code review, infra critical (auth, base modules), tích hợp IoT | 60% | 40% |
| Backend Dev #1 (Business) | Member A | Meeting, Scheduling, Booking, Conflict detection, In-meeting | 90% | 10% |
| Backend Dev #2 (IoT) | Member B | IoT ingestion, Attendance, Occupancy, No-show, Recording integration | 90% | 10% |
| Frontend Dev #1 (UI Core) | Member C | Auth, Account, Room, Equipment, Meeting CRUD UI | 100% | 0% |
| Frontend Dev #2 (Realtime + Dashboard) | Member D | In-meeting UI, WebSocket integration, Dashboard, Analytics charts | 100% | 0% |
| DevOps / Full-stack helper | Member E (cần tuyển) | Docker, CI/CD, Camera Service (Python), Recording Worker, deployment, dev support | 80% | 20% infra design |

### C.1.2. ⚡ NEW Plan B — Fallback 5 dev (nếu không tuyển được Member E)

Nếu không kịp tuyển Member E trước Sprint 0, kế hoạch phải điều chỉnh ngay. **Không thể "ai cũng nhận thêm việc DevOps + Python"** vì sẽ vỡ Sprint 5-6.

**Điều chỉnh:**

| Hạng mục | Plan B |
|---|---|
| Camera Service (Python) | Tech Lead viết, ưu tiên Sprint 0-2 (lúc còn time). Member B maintain từ S3. |
| Recording Worker (Node + FFmpeg) | Member B làm, lùi từ S6 sang S5 nhẹ (chuẩn bị trước). |
| Docker Compose + Deploy | Tech Lead + Member B chia. Setup ở S0, sau đó stable thì không cần touch. |
| CI/CD | Tech Lead làm S0, sau đó không thay đổi nhiều. |
| Scope cut | **Loại bỏ STT (UC-TRS-01) và Minutes (UC-MIN-01/02) khỏi Sprint 7.** Sprint 7 chỉ hardening + UAT. |
| Risk score | R6 (member nghỉ) từ Medium → High; R13 (no DevOps) → CRITICAL |

**Quyết định lock 5-dev / 6-dev: trước Sprint 0 (cuối tuần 0).** Sau đó không đổi.

### C.1.3. Quy tắc cộng tác

- Mọi PR cần ít nhất 1 review trước merge; PR có thay đổi schema DB cần Tech Lead duyệt.
- Daily standup 15 phút (sáng) — what / blockers / today plan.
- Sprint planning 2h đầu sprint; sprint review 1h cuối sprint với lecturer.
- Mỗi member "own" 1 module chính nhưng phải pair-test với người khác trước merge.
- Tech Lead có quyền veto trong các quyết định kiến trúc và scope; tranh chấp đưa lecturer.
- **Bug-blocker rule:** Bug HIGH/CRITICAL ở MUST UC → toàn bộ feature mới dừng cho đến khi fix. Sprint backlog re-prioritize.

## C.2. Roadmap tổng quan (8 sprint × 2 tuần)

| Sprint | Tuần | Theme | Deliverable chính | Milestone |
|---|---|---|---|---|
| S0 | 1-2 | Foundation & Vertical Slice | Kiến trúc lock, ERD v1, CI/CD, IoT simulator, Auth skeleton + UI login | M0: "Hello world" deployable |
| S1 | 3-4 | Auth + Account + Org | Auth flow đầy đủ, Account CRUD, Department, RBAC | **M1: Demo login + tạo user** |
| S2 | 5-6 | Room + Equipment + Meeting Foundation | Room CRUD, Equipment, Meeting one-time create + edit + cancel | |
| S3 | 7-8 | Scheduling + IoT Registry | Conflict detection (exclude constraint), IoT device registry, heartbeat, raw event ingestion | **M2: End-to-end meeting tạo + invite** |
| S4 | 9-10 | Face Attendance + Notification | Face event processing, attendance auto-create, email outbox pipeline | |
| S5 | 11-12 | Occupancy + No-show + In-meeting | Camera Service integration, occupancy state, no-show detection + auto-release, in-meeting UI, WebSocket | **M3: Full meeting lifecycle live** |
| S6 | 13-14 | Recording + Dashboards | Recording start/stop + orphan recovery, playback, Analytics dashboards, RESTORE DRILL | |
| S7 | 15-16 | Hardening + Extended + UAT | Bug fix, load test, optional STT + minutes draft, documentation, UAT | **M4: Final demo** |

## C.3. Chi tiết từng Sprint

### Sprint 0 (Tuần 1-2): Foundation & Vertical Slice

**Mục tiêu:** Mọi quyết định kiến trúc/tech stack được lock; có 1 "vertical slice" login chạy được trên dev server; simulator IoT sẵn sàng; **scope-lock meeting với lecturer hoàn thành (giải quyết tất cả BR cần xác nhận ở §B.5.7).**

Tasks chia theo người:

| Người | Task | Estimate (giờ) |
|---|---|---|
| Tech Lead | Vẽ C4 diagram (Context + Container), viết Architecture Decision Records (20 ADR), chốt tech stack với team + lecturer | 16 |
| Tech Lead | **Họp scope-lock với lecturer: confirm 8 BR ở §B.5.7 + 7 câu Q1-Q7 ở §C.6** | 4 |
| Tech Lead | Setup repo Git, monorepo (apps/backend, apps/frontend, services/camera, services/recording), branch strategy | 8 |
| Tech Lead | ERD v1 cho 5 module đầu: Identity, Org, Room, Meeting, Booking | 12 |
| Tech Lead | **Viết migration exclude constraint cho booking (raw SQL)** | 4 |
| Tech Lead | **ESLint boundaries rule setup (xem §A.2.4)** | 4 |
| BE #1 | Khởi tạo NestJS skeleton, Prisma setup, migration đầu, base module structure | 16 |
| BE #1 | Triển khai Auth module (UC-AUTH-01 happy path): login JWT + refresh + password_changed_at | 16 |
| BE #2 | Triển khai IoT Event Simulator (Node.js script gửi mock event Face + Occupancy với HMAC) | 16 |
| BE #2 | Endpoint ingestion stub `/iot/face/verify` nhận event, verify HMAC, lưu raw vào DB | 8 |
| FE #1 | Vite + React + TS skeleton, Tailwind + shadcn/ui setup, routing | 12 |
| FE #1 | Layout: Login page, AppShell với sidebar, AuthContext + axios interceptor | 16 |
| FE #2 | Setup TanStack Query, axios client, error handling, common components (Form, Table, Modal) | 16 |
| DevOps | Docker Compose dev environment (Postgres + Redis AOF + MinIO + Backend + Frontend) | 16 |
| DevOps | CI pipeline (GitHub Actions): lint + test + build trên mỗi PR | 12 |
| DevOps | Staging server VPS, domain dev, Caddy reverse proxy, HTTPS | 12 |
| DevOps | **Postgres WAL archiving setup + nightly pg_dump script** | 8 |

**Definition of Done Sprint 0:** (1) Bất kỳ dev nào clone repo, chạy `docker-compose up` → toàn bộ stack chạy được. (2) User mock login → vào dashboard. (3) Simulator gửi event → DB có raw record. (4) ADR + ERD + 8 BR confirm hết với lecturer, checked vào docs/. (5) Exclude constraint trong migration verified. (6) Boundaries lint rule active.

### Sprint 1 (Tuần 3-4): Auth + Account + Org

**Mục tiêu:** Hoàn thiện toàn bộ Identity module. Người dùng thật có thể đăng nhập, đổi password, admin tạo/quản lý account và department. Milestone M1.

| UC | Người | Note |
|---|---|---|
| UC-AUTH-01 Đăng nhập (hoàn thiện) | BE #1 + FE #1 | Bao gồm error handling, locked account, OTP reset |
| UC-AUTH-02 Đăng xuất | BE #1 + FE #1 | Refresh token revoke với reason='LOGOUT' |
| UC-AUTH-03 Reset password OTP | BE #1 + FE #1 | Nodemailer + Redis OTP store + rate limit + outbox |
| UC-AUTH-04 Đổi password | BE #1 + FE #1 | **Revoke all refresh tokens (BR §A.9.1)** |
| UC-ACC-01 Tạo account đơn lẻ | BE #1 + FE #1 | Random password + email qua outbox |
| UC-ACC-03 Update account | BE #1 + FE #1 | Self-edit limited fields |
| UC-ACC-04 Khóa/mở account | BE #1 + FE #1 | Revoke all tokens khi khóa |
| UC-ACC-05 Phân quyền (role) | BE #1 + FE #1 | Role list cố định |
| UC-ACC-06 Search/filter account | BE #1 + FE #1 | Pagination |
| UC-ACC-08 Department CRUD | BE #1 + FE #1 | |
| RBAC Guard + decorator hoàn thiện | Tech Lead | Test cover tất cả role |
| **BullMQ + email outbox worker setup (đầy đủ với DLQ)** | BE #2 | Theo §A.9.6 |
| Camera Service skeleton (Python) + Dockerfile | DevOps | Đọc RTSP mock, push event mỗi 30s với HMAC |
| Dashboard skeleton + UserContext + Role-based menu | FE #2 | |
| **WS Gateway với Redis adapter setup** | Tech Lead | Theo §A.9.7 |

**Milestone M1 demo:** Buổi cuối sprint demo với lecturer (1) login/logout, (2) reset password qua email OTP, (3) admin tạo 5 user qua UI, (4) admin gán role, (5) user A login chỉ thấy menu của role mình, (6) đổi password → refresh token bị revoke (verify bằng cách thử dùng token cũ).

### Sprint 2 (Tuần 5-6): Room + Equipment + Meeting Foundation

| UC | Người |
|---|---|
| UC-ROOM-01 Room CRUD | BE #1 + FE #1 |
| UC-ROOM-02 Search/filter room | BE #1 + FE #1 |
| UC-ROOM-04 **(NEW)** Cấu hình policy phê duyệt phòng | BE #1 + FE #1 |
| UC-EQ-01/02/03 Equipment management | BE #1 + FE #1 |
| UC-MTG-01 Tạo meeting one-time (basic, chưa conflict check) | BE #1 + FE #2 |
| UC-MTG-02 Cập nhật meeting | BE #1 + FE #2 |
| UC-MTG-03 Hủy meeting | BE #1 + FE #2 |
| UC-MTG-04 Quản lý participant | BE #1 + FE #2 |
| UC-MTG-06 Lịch cá nhân (calendar view) | FE #2 |
| IoT Ingestion endpoint hoàn thiện + HMAC + rate limit | BE #2 + Tech Lead |
| Camera Service: kết nối được RTSP thật (nếu có hardware) hoặc mock-stream | DevOps |
| Migration v2: meetings, meeting_occurrences, meeting_participants, agendas, room_booking_usages + exclude constraint apply | Tech Lead |

### Sprint 3 (Tuần 7-8): Scheduling + IoT Registry

| UC | Người |
|---|---|
| UC-SCH-01 Conflict detection (xác nhận exclude constraint work với concurrency test) | BE #1 |
| UC-SCH-02 Gợi ý phòng khả dụng | BE #1 + FE #2 |
| UC-SCH-04 Phê duyệt/từ chối booking (theo BR-BOOK-01) | BE #1 + FE #2 |
| UC-MTG-07 Agenda CRUD | BE #1 + FE #2 |
| UC-IOT-01 Đăng ký device | BE #2 + FE #1 |
| UC-IOT-02 Cấu hình Face Server callback | BE #2 + FE #1 |
| UC-IOT-03 Cấu hình RTSP | BE #2 + FE #1 |
| UC-IOT-04 Heartbeat handler | BE #2 |
| UC-IOT-06 Device list + sức khỏe | BE #2 + FE #1 |
| Device-User Mapping (UC-ACC-09) | BE #2 + FE #1 |
| BullMQ scheduled job framework | Tech Lead |
| Frontend: complete Meeting create form + calendar view | FE #2 |
| **Integration test concurrency: 100 request đồng thời đặt cùng phòng → 1 thành công** | Tech Lead |

**Milestone M2 demo:** (1) Host tạo meeting có conflict check, (2) approver duyệt, (3) participant nhận email mời (qua outbox), (4) admin đăng ký Face Terminal vào phòng, (5) simulator gửi event verify, (6) raw event lưu vào DB (chưa cần thấy attendance — đó là Sprint 4).

### Sprint 4 (Tuần 9-10): Face Attendance + Notification

| UC | Người |
|---|---|
| UC-IOT-05 Normalize event + worker pipeline (với schema version) | BE #2 + Tech Lead |
| UC-ATT-01 Auto-create attendance từ Face event | BE #2 |
| UC-ATT-02 Manual attendance | BE #2 + FE #2 |
| UC-ATT-03 Edit/invalidate attendance | BE #2 + FE #2 |
| UC-ATT-04 Xem danh sách attendance | BE #2 + FE #2 |
| UC-ATT-06 Unknown face detection + alert | BE #2 + FE #2 |
| UC-NOTI-01/02/03 Email pipeline (invite, reminder, cancel) đầy đủ outbox với idempotency | BE #1 |
| UC-MTG-08 Đặt phòng ad-hoc | BE #1 + FE #2 |
| FE #2: Attendance page + real-time presence | |
| WebSocket Gateway implementation hoàn chỉnh | Tech Lead + BE #2 |
| WebSocket auth + room subscription | Tech Lead |

### Sprint 5 (Tuần 11-12): Occupancy + No-show + In-meeting

| UC | Người |
|---|---|
| UC-OCC-01 Receive camera occupancy event | BE #2 |
| UC-OCC-02 Real-time room state update + WS push | BE #2 |
| UC-OCC-03 Real-time room status dashboard | FE #2 |
| UC-NS-01 Auto-detect no-show (BullMQ scheduled, theo BR-NS-01) | BE #2 |
| UC-NS-02 Warning to host | BE #2 |
| UC-NS-03 Auto-release after threshold với jobId deterministic | BE #2 |
| UC-NS-04 Manual release | BE #1 + FE #2 |
| UC-NS-05 No-show list view | BE #1 + FE #2 |
| UC-NS-06 Config threshold | BE #1 + FE #1 |
| UC-IM-01 Start/end session (state machine) | BE #1 + FE #2 |
| UC-IM-03 Live presence list | BE #1 + FE #2 |
| UC-IM-04 Time-remaining warning (5 phút trước scheduled_end) | BE #1 |
| UC-MTG-11 **(NEW)** Meeting overrun handling (BR-MTG-OVERRUN-01) | BE #1 |
| UC-ATT-05 Personal entry/exit history | BE #2 + FE #2 |
| UC-ATT-07 Late check-in alert | BE #2 |
| Camera Service: tích hợp với real hardware (nếu có) hoặc finalize mock | DevOps + BE #2 |
| UC-CFG-01 System configuration | BE #1 + FE #1 |

**Milestone M3 demo:** Full luồng: tạo meeting → đến giờ không ai vào → no-show warning → 5 phút sau auto-release → email gửi Host. Hoặc: đến giờ có người vào → attendance + presence list real-time update trên dashboard. **ĐÂY LÀ ĐIỂM PHÂN BIỆT CỦA PROJECT.**

### Sprint 6 (Tuần 13-14): Recording + Dashboards

| UC | Người |
|---|---|
| UC-MTG-09 Cấu hình recording cho meeting + consent flow (BR-PRIV-01) | BE #1 + FE #2 |
| UC-REC-01 Start/stop recording (1 camera) | BE #2 + DevOps |
| UC-REC-03 Media file metadata + retention_until | BE #2 |
| UC-REC-04 Playback (signed URL TTL dynamic theo ADR-18) | BE #2 + FE #2 |
| UC-REC-05 Recording list | BE #2 + FE #2 |
| UC-REC-06 Delete/hide recording | BE #2 + FE #2 |
| UC-REC-07 Real-time recording error alert | BE #2 + FE #2 |
| UC-REC-09 **(NEW)** Orphan recovery sau worker restart | BE #2 + DevOps |
| Recording Worker (Node + FFmpeg) với heartbeat + cgroup limit | DevOps + BE #2 |
| UC-RPT-01 Dashboard tổng quan | BE #1 + FE #2 |
| UC-RPT-02 Dashboard room utilization | BE #1 + FE #2 |
| UC-RPT-03 Dashboard attendance & presence | BE #1 + FE #2 |
| UC-RPT-04 No-show rate report | BE #1 + FE #2 |
| UC-NS-08 Export room usage report (CSV) | BE #1 + FE #1 |
| UC-IM-02 Meeting timeline view | BE #1 + FE #2 |
| **RESTORE DRILL: kill staging, restore từ backup, đo RTO** | Tech Lead + DevOps |

### Sprint 7 (Tuần 15-16): Hardening + Extended + UAT

Đây là sprint quan trọng nhất về mặt chất lượng. **KHÔNG nhận thêm task feature lớn. Buffer 1 tuần.**

| Hạng mục | Người | Note |
|---|---|---|
| Bug bash tập thể 1 ngày (cả team test cross-module) | Cả team | Log bug Jira |
| Fix bug priority HIGH + CRITICAL | Cả team | |
| Performance test với 200 concurrent user (k6 / Locust) | Tech Lead + DevOps | Đo p95, verify NFR |
| Security review checklist (OWASP Top 10 ASVS) | Tech Lead | |
| **AC Gherkin pass 100% cho UC MUST** | Cả team | QA round cuối |
| UC-ACC-10 **(NEW)** Anonymize / data deletion | BE #1 + FE #1 | |
| UC-TRS-01 STT single-channel + UC-TRS-02 view transcript (Extended) | BE #2 | Chỉ nếu Sprint 6 đúng tiến độ và Plan A |
| UC-MIN-01/02 Minutes draft + publish (Extended) | BE #1 + FE #2 | Chỉ nếu Plan A |
| UC-CFG-02 Audit log viewer | BE #1 + FE #1 | |
| UC-RPT-05 Export PDF/Excel | BE #1 + FE #1 | |
| UAT với lecturer + 2 user thật | Cả team | 1.5 ngày |
| Documentation: API docs (Swagger), user manual, deployment guide | Tech Lead + cả team | |
| Demo script + slide | Tech Lead + Member trình bày | |
| Final report (Report Final) | Cả team chia mỗi phần | |
| Demo rehearsal 2 lần | Cả team | |

**Milestone M4 demo cuối:** Demo end-to-end với lecturer + hội đồng. Phải có: full meeting lifecycle, recording playback, dashboard real, no-show auto-flow, attendance từ Face Terminal hoặc simulator.

## C.4. Risk Register

17 rủi ro chính, sắp xếp theo Probability × Impact. Mỗi rủi ro có owner + mitigation cụ thể.

| # | Rủi ro | P | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | Hardware Face Terminal / IP Camera không có hoặc giao trễ | H | H | 9 | Build IoT simulator từ S0; ký kết deadline hardware với lecturer trước S2 | Tech Lead |
| R2 | Scope creep — lecturer ép giữ recurring meeting / multi-channel audio | H | H | 9 | Họp scope-lock với lecturer S0; ký MoSCoW; nhật ký scope change | Tech Lead |
| R3 | FFmpeg/RTSP recording không stable (crash, leak file, orphan process) | M | H | 6 | Spike kỹ thuật S0; health check process + cgroup limit; auto-restart worker; orphan recovery UC-REC-09 | BE #2 + DevOps |
| R4 | Conflict detection có race condition | L | H | 3 | **ADR-17 exclude constraint** giải quyết ở DB level; concurrency test S3 | BE #1 |
| R5 | Email không gửi được khi SMTP down | L | M | 2 | **Outbox pattern đầy đủ §A.9.6** với DLQ; monitoring | BE #1 |
| R6 | Member nghỉ học / nghỉ giữa chừng | M | H | 6 | Pair coding các module critical; doc rõ; cross-train; **Plan B 5-dev §C.1.2** | Tech Lead |
| R7 | Google STT chi phí vượt budget hoặc quota hết | M | L | 2 | STT là COULD; có thể bỏ; fallback Whisper local | BE #2 |
| R8 | Database query chậm khi nhiều dữ liệu (dashboard) | M | M | 4 | Index plan từ S0; Redis cache 5-15p; **archive strategy §A.7.5**; load test S7 | Tech Lead |
| R9 | WebSocket không scale, mất kết nối | L | M | 2 | **Redis adapter từ S1 (ADR-16)**; heartbeat + reconnect; polling fallback | BE #2 + FE #2 |
| R10 | Privacy concern từ hội đồng (recording PII) | M | M | 4 | **§B.5.5 BR-PRIV-* đầy đủ**: consent flow, retention, anonymize | Tech Lead |
| R11 | Frontend chậm tiến độ hơn backend | M | M | 4 | Vertical slice mỗi sprint (FE+BE cùng tiến); standup catch sớm | Tech Lead |
| R12 | Integration giữa Camera Service (Python) và Backend (Node) lỗi format | M | M | 4 | **event_schema_version trong payload**; JSON Schema contract test mock 2 chiều từ S0 | Tech Lead |
| R13 | Không có DevOps chuyên → deploy lỗi cuối kỳ | M | H | 6 | Deploy lên staging từ S0; deploy thường xuyên; doc rõ; **restore drill S6** | DevOps |
| R14 | Bug tích lũy → demo cuối fail | L | H | 3 | S7 bug bash; smoke test scripted; rehearsal 2 lần; **AC Gherkin gate** | Tech Lead |
| R15 | Lecturer thay đổi yêu cầu lớn giữa kỳ | L | H | 3 | Document scope chính thức; thay đổi → impact analysis + approval | Tech Lead |
| **R16** *(NEW)* | Vendor Face Server bug spam event → DoS DB | L | H | 3 | **Rate limit + circuit breaker §A.9.8**; alert WS | BE #2 |
| **R17** *(NEW)* | Disk staging đầy do recording (90 ngày × 28GB/ngày = 2.5TB) | M | M | 4 | **Capacity §A.6.2** đã tính; demo dùng S3 thật; staging giảm retention xuống 14 ngày | DevOps |

Ghi chú: P=Probability (L=Low, M=Medium, H=High), I=Impact tương tự. Score = P × I numeric (L=1, M=2, H=3). Score ≥ 6 → review tuần.

## C.5. Definition of Done

### Story / Use Case DoD

- Code đã viết và commit theo branch convention (`feature/UC-XXX-yyy`).
- Unit test cho service layer, tối thiểu happy path + 1 edge case.
- **AC Gherkin pass 100% cho UC MUST (test runner verify) *(NEW v2)***
- PR đã được ít nhất 1 reviewer approve.
- Đã pass CI (lint + test + build + **boundaries lint**).
- Đã test thủ công ít nhất 1 lần trên dev environment.
- Documentation cập nhật: API docs (Swagger), README nếu có thay đổi setup.
- Không có `console.log` / `TODO` chưa giải quyết trong code merged.
- Kéo về main và deployed lên staging.

### Sprint DoD

- Tất cả story "committed" trong sprint planning đã DONE hoặc đã đưa lại backlog với lý do.
- Sprint demo với lecturer hoàn thành.
- Sprint retro thực hiện; action items ghi nhận.
- Velocity (story points) cập nhật để planning sprint sau.

### Milestone DoD

- Demo script viết sẵn, chạy được không sót bước.
- Smoke test scripted pass 100%.
- Risk register cập nhật.
- Document architecture / SRS / SDD cập nhật.
- Lecturer + ít nhất 1 member ngoài team chạy demo thành công.

## C.6. Giả định & quyết định cần lecturer xác nhận sớm

Trước khi vào Sprint 1, team cần buổi họp với lecturer để xác nhận các điểm sau. Nếu không xác nhận, kế hoạch trên có thể phải điều chỉnh:

| # | Câu hỏi | Giả định hiện tại | Tác động nếu khác |
|---|---|---|---|
| Q1 | Hardware Face Terminal + IP Camera có sẵn không? Khi nào? | Giả định: sẵn trước S4. Nếu không → simulator cho demo | Demo M3, M4 có thể giảm impact |
| Q2 | Budget AWS hoặc cloud có không? | Giả định: KHÔNG; dùng VPS + MinIO self-hosted | Nếu có → swap MinIO → S3, SMTP → SES |
| Q3 | Lecturer chấp nhận MoSCoW (loại Recurring + Multi-channel audio + 2-camera tracking)? | Giả định: CÓ | Nếu KHÔNG → cắt 5-7 UC SHOULD/COULD bù |
| Q4 | Demo cuối có cần tích hợp Face Terminal thật không, hay simulator được? | Giả định: simulator OK, hardware là bonus | Nếu yêu cầu hardware → R1 thành CRITICAL |
| Q5 | Số phòng / số user demo mục tiêu? | Giả định: 5 phòng, 50 user, 10 meeting/ngày | Nếu lớn hơn → cần load test sớm hơn |
| Q6 | Privacy/recording — có cần consent flow chính thức trong demo? | **Giả định: có (BR-PRIV-01 đầy đủ)** | Nếu chỉ cần checkbox → giảm 3 ngày work |
| Q7 | Team có thực sự 6 dev? | **Giả định: 5 dev hiện tại + 1 cần tuyển/mượn. Có Plan B §C.1.2** | Nếu chỉ 5 → activate Plan B |
| **Q8** *(NEW)* | Confirm 8 BR ở §B.5.7 | Như mô tả trong B.5 | Nếu khác → revise UC tương ứng |

## C.7. KPI thành công của project

| KPI | Mục tiêu | Cách đo |
|---|---|---|
| Hoàn thành MUST UC | 100% (32/32 UC) | Tracking Jira |
| Hoàn thành SHOULD UC | ≥ 85% (~17/20 UC) | Tracking Jira |
| Demo M1, M2, M3, M4 pass | 4/4 | Lecturer chấm pass/fail |
| Unit test coverage (service layer) | ≥ 60% | Coverage report |
| **AC Gherkin pass cho UC MUST** *(NEW v2)* | **100%** | Test runner (Cucumber/Jest) |
| Số bug HIGH/CRITICAL còn open lúc demo cuối | 0 | Jira |
| API p95 latency | < 500ms cho 95% endpoint | Load test k6 |
| Uptime staging trong S4-S7 | ≥ 95% giờ hành chính | Uptime monitor |
| **RTO restore drill** *(NEW v2)* | **< 2h actual** | Drill cuối S6 |
| Đạt điểm hội đồng phản biện | ≥ điểm B+ (75/100) | Kết quả chính thức |

---

# Phụ lục

## D.1. Decision Log (mở rộng từ v1)

Bảng tổng hợp mọi quyết định kiến trúc & scope đã ra, làm cơ sở traceability khi review hoặc thay đổi. Tham chiếu các ADR liên quan ở §A.5.

| # | Quyết định | Ngày | Người chốt | Lý do | Trade-off chấp nhận | Status |
|---|---|---|---|---|---|---|
| D-01 | Modular Monolith cho backend chính | T1/W1 | Tech Lead + team | Phù hợp scale capstone, dễ test, deploy 1 unit | Không scale từng module riêng được | Locked |
| D-02 | NestJS + Prisma + Postgres làm core | T1/W1 | Tech Lead | TS đầy đủ, module DI chuẩn, ORM mạnh | Học NestJS có cost ~1 tuần | Locked |
| D-03 | React + Vite + TanStack Query | T1/W1 | FE leads | Đơn giản, modern, không cần SSR | Không có SEO (không cần) | Locked |
| D-04 | BullMQ làm queue duy nhất | T1/W2 | Tech Lead | Redis sẵn có; dashboard tốt | Phụ thuộc Redis | Locked |
| D-05 | MinIO dev, S3 demo | T1/W2 | DevOps | Tránh tốn credit; cùng SDK | Hai môi trường khác nhau | Locked |
| D-06 | Loại Recurring meeting khỏi MVP | T1/W2 | Tech Lead + lecturer | Phức tạp, ít trọng số chấm | Mất 1 feature | Locked |
| D-07 | Loại Multi-channel audio khỏi MVP | T1/W2 | Tech Lead + lecturer | Hardware không đảm bảo, scope quá lớn | STT chỉ single-channel | Locked |
| D-08 | Loại 2-camera tracking cá nhân khỏi MVP | T1/W2 | Tech Lead + lecturer | Cần ML training, không khả thi | Hiện diện chỉ ở mức phòng | Locked |
| D-09 | Camera Service viết Python | T1/W2 | Tech Lead | OpenCV/YOLO ecosystem mạnh; tách process | 1 ngôn ngữ nữa | Locked |
| D-10 | Recording Worker viết Node + FFmpeg | T1/W2 | Tech Lead | Cùng ngôn ngữ team chính | FFmpeg cần spike S0 | Locked |
| **D-11** *(NEW v2)* | **Conflict prevention bằng EXCLUDE constraint (ADR-17)** thay app-level lock | T1/W1 | Tech Lead | Atomic ở DB, không race | Phải btree_gist extension | Locked |
| **D-12** *(NEW v2)* | **WS Redis adapter setup từ S1 (ADR-16)** dù 1 instance | T1/W1 | Tech Lead | Cost migration sau gần 0 | Thêm dependency Redis cho WS | Locked |
| **D-13** *(NEW v2)* | **Outbox pattern bắt buộc cho mọi email** | T1/W1 | Tech Lead | Reliability + idempotency | +1 table + 1 worker | Locked |
| **D-14** *(NEW v2)* | **Anonymize thay xóa cứng user (BR-PRIV-02)** | T1/W2 | Tech Lead + lecturer | FK integrity + PDPA compliant | UI phải handle "Deleted User" | Locked |
| **D-15** *(NEW v2)* | **Face data KHÔNG lưu backend (ADR-19)** | T1/W1 | Tech Lead | Giảm bề mặt PII | Phụ thuộc vendor Face Server | Locked |
| **D-16** *(NEW v2)* | **Signed URL TTL dynamic theo duration (ADR-18)** | T1/W2 | BE #2 | Tránh URL expire khi xem dài | Audit log nhiều entry hơn | Locked |
| **D-17** *(NEW v2)* | **Rate limit + circuit breaker cho ingestion endpoint** | T1/W2 | Tech Lead | Bảo vệ DB khỏi vendor bug | Vendor có thể phàn nàn về 429 | Locked |
| **D-18** *(NEW v2)* | **Plan B 5-dev nếu không tuyển kịp Member E** | T1/W0 | Tech Lead | Realistic về resource | Cắt STT + Minutes nếu activated | Conditional |
| **D-19** *(NEW v2)* | **AC Gherkin bắt buộc cho UC MUST** | T1/W1 | Tech Lead | Bảo vệ chất lượng + sync QA-dev | Effort viết Gherkin +10% per UC | Locked |
| **D-20** *(NEW v2)* | **RPO 24h / RTO 4h + restore drill S6** | T1/W2 | Tech Lead | Demo độ chín cho hội đồng | +2 ngày work S0 + 1 ngày S6 | Locked |

## D.2. Use Case Template

### D.2.1. Template chi tiết (cho UC MUST)

Mọi UC trong nhóm MUST phải dùng template này khi viết Report 2.

```markdown
### UC-XXX-NN: <Tên Use Case>

**UC ID & Name:** UC-XXX-NN — <tên>
**Primary Actor:** <role>
**Description:** <1-2 câu mô tả>
**Trigger:** <hành động khởi đầu>
**Precondition:**
  - PRE-1: ...
  - PRE-2: ...
**Postcondition:**
  - POST-1: ...
  - POST-2: ...
**Normal Flow:**
  1. ...
  2. ...
**Alternative Flow:**
  - AF1 (<điều kiện>): ...
**Exception:**
  - EX1: ...
**Business Rule:** BR-XXX-NN (link tới §B.5)
**Frequency:** <ước tính lượt/ngày>
**Priority:** MUST | SHOULD | COULD | WON'T
**Non-functional:** p95 latency, throughput target

**Acceptance Criteria (Gherkin):**

```gherkin
Feature: <feature name>
  Background:
    Given <preconditions chung>

  Scenario: Happy path
    Given ...
    When ...
    Then ...

  Scenario: <edge case>
    ...
```
```

### D.2.2. Template rút gọn (cho UC SHOULD/COULD)

UC không thuộc MUST có thể dùng template rút gọn:

```markdown
### UC-XXX-NN: <Tên>
- Actor: <role>
- Mô tả: <1 câu>
- Pre/Post: <gọn>
- Normal flow: 3-5 bước key
- Note: <link UC liên quan>
- Priority: SHOULD/COULD
```

## D.3. Tài liệu cần tạo trong giai đoạn này

Để hoàn tất Report 2, ngoài bản kế hoạch này, team cần chuẩn bị:

1. **Software Requirements Specification (SRS) v2** — chi tiết Functional + Non-functional + UC catalog đầy đủ + **8 BR §B.5.7 đã confirmed**. Trách nhiệm: Tech Lead + cả team viết phần module mình.
2. **Software Design Description (SDD)** — bao gồm Architecture Overview (rút từ Phần A), ERD đầy đủ với mọi bảng, API specification (OpenAPI/Swagger), Sequence diagrams cho 4 luồng critical (§A.8), State machine cho meeting + recording + no-show. Trách nhiệm: Tech Lead chủ trì.
3. **Database Design Document** — ERD chuẩn (PowerDesigner/dbdiagram.io), Data Dictionary, Migration plan, **Index strategy + Exclude constraint migration**. Trách nhiệm: Tech Lead.
4. **Sprint Plan + Backlog (Jira/Trello)** — Epic → Story → Task; estimate; assignment. Trách nhiệm: Tech Lead.
5. **Risk Management Plan** — Risk register + Mitigation + Owner (đã có ở §C.4). Trách nhiệm: Tech Lead.
6. **Testing Plan** — Test strategy, Test case template, **AC Gherkin cho UC MUST**, UAT plan. Trách nhiệm: Tech Lead + Member D (đảm nhiệm QA).
7. **Deployment & Operation Document** — Docker Compose, CI/CD pipeline, **WAL archive + restore drill procedure**, monitoring plan, runbook. Trách nhiệm: DevOps (Member E).

## D.4. ⚡ NEW Glossary — Thuật ngữ kỹ thuật

| Thuật ngữ | Nghĩa trong project SMRMPTS |
|---|---|
| **ADR** (Architecture Decision Record) | Bản ghi 1 quyết định kiến trúc với context, decision, consequences. Format ngắn — không phải báo cáo. |
| **AOF** (Append-Only File) | Cơ chế persistence của Redis. Lưu mọi write operation ra file, replay khi restart. Bắt buộc bật trong project. |
| **Anonymize** | Xóa thông tin định danh nhưng giữ row trong DB. Dùng cho right-to-be-forgotten thay vì hard delete (BR-PRIV-02). |
| **BR** (Business Rule) | Quy tắc nghiệp vụ tách khỏi UC. Có mã `BR-<scope>-NN`, ví dụ `BR-NS-01`. Xem §B.5. |
| **BullMQ** | Job queue lib Node.js dựa trên Redis. Hỗ trợ delayed job, repeat, dedupe qua jobId, DLQ. |
| **Circuit Breaker** | Pattern đóng cửa endpoint khi quá nhiều fail, ngăn cascade failure. Dùng cho ingestion endpoint (§A.9.8). |
| **Consent flow** | Luồng xin phép user trước khi thực hiện hành động ảnh hưởng PII (recording). Xem BR-PRIV-01. |
| **DLQ** (Dead Letter Queue) | Nơi chứa job/message thất bại sau max retry. Cần endpoint admin xem và retry thủ công. |
| **EXCLUDE Constraint** | PostgreSQL constraint chặn 2 row có giá trị "đụng nhau" theo định nghĩa range. Cần extension btree_gist. Dùng cho conflict prevention (ADR-17). |
| **Exponential Backoff** | Chiến lược retry với delay tăng dần (2^N seconds), tránh dồn dập làm tệ thêm. Outbox + face event worker dùng pattern này. |
| **FFmpeg** | CLI tool ghi/chuyển đổi video. Spawn làm child process trong Recording Worker. |
| **GIST Index** | Loại index Postgres hỗ trợ "đụng nhau" operator (&&) cho range type. Bắt buộc cho EXCLUDE Constraint. |
| **Gherkin** | DSL cú pháp Given/When/Then mô tả Acceptance Criteria. Đọc được bởi cả dev, BA, QA. |
| **HMAC** (Hash-based Message Authentication Code) | Cơ chế ký request bằng shared secret + SHA256. Dùng để xác thực Face Server callback (§A.9.1). |
| **Idempotency Key** | Khóa định danh duy nhất một thao tác, đảm bảo retry không tạo 2 lần. Format theo template ở §A.9.6. |
| **Ingestion endpoint** | Endpoint nhận event từ external (Face Server, Camera Service). Tách khỏi business API để rate limit + circuit break riêng. |
| **MoSCoW** | Phương pháp ưu tiên: Must / Should / Could / Won't. Xem §B.1. |
| **Modular Monolith** | Monolith với boundary module rõ ràng, có thể tách thành microservice sau. Phong cách kiến trúc đã chọn (ADR-01). |
| **NFR** (Non-Functional Requirement) | Yêu cầu phi chức năng: performance, security, reliability... Xem §A.1.1. |
| **Optimistic Locking** | Concurrency strategy dùng cột `version`, throw nếu version mismatch khi UPDATE. Dùng cho meetings, occurrences. |
| **Orphan FFmpeg / Orphan Recording** | FFmpeg process còn sống nhưng worker đã chết → file ghi tiếp, không upload, mất tracking. Cần recovery (UC-REC-09). |
| **Outbox Pattern** | Lưu side-effect (vd email) vào table trong cùng transaction nghiệp vụ. Worker async pick up. Đảm bảo "at-least-once với commit". §A.9.6. |
| **PDPA** (Personal Data Protection Act) | Nghị định bảo vệ dữ liệu cá nhân VN. Recording + face data thuộc dữ liệu nhạy cảm. |
| **person_code** | Mã định danh của vendor Face Server cho 1 khuôn mặt. Backend chỉ lưu reference này, không lưu face image (ADR-19). |
| **RBAC** (Role-Based Access Control) | Phân quyền theo role. Project dùng RBAC + ABAC (kiểm thêm ownership tài nguyên). |
| **RPO** (Recovery Point Objective) | Mức dữ liệu tối đa chấp nhận mất khi disaster. Project: ≤ 24h (WAL ≤ 5 phút). |
| **RTO** (Recovery Time Objective) | Thời gian tối đa từ disaster đến hoạt động lại. Project: ≤ 4h. Có drill ở Sprint 6. |
| **Signed URL** | URL có chữ ký + TTL cho phép access object S3 mà không cần auth. Dùng cho playback recording (ADR-18). |
| **SKIP LOCKED** | Tùy chọn của Postgres `SELECT ... FOR UPDATE SKIP LOCKED` — bỏ qua row đang lock. Dùng cho worker pool poll outbox. |
| **TTL** (Time To Live) | Thời gian sống của entry (Redis key, signed URL, OTP). Hết → tự xóa/invalid. |
| **WAL** (Write-Ahead Log) | Postgres log mọi thay đổi trước khi flush data file. Archive WAL = backup tới điểm cuối. |
| **WebSocket** | Giao thức 2 chiều persistent dùng cho real-time push. Project dùng Socket.IO + Redis adapter. |

## D.5. ⚡ NEW Reference Code Snippets

Snippet rút gọn cho các pattern phức tạp được tham chiếu trong spec. Code đầy đủ trong repo `apps/backend/src/`.

### D.5.1. Exclude Constraint Migration

```sql
-- apps/backend/prisma/migrations/20260601_booking_exclude/migration.sql

-- Bắt buộc extension này; chỉ cần chạy 1 lần
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Cột generated, tính từ start/end. STORED = lưu vào row, không tính lại mỗi query.
ALTER TABLE room_booking_usages
  ADD COLUMN reserved_range tstzrange GENERATED ALWAYS AS
    (tstzrange(reserved_start, reserved_end, '[)')) STORED;

-- Constraint: cùng room_id, range nào && (overlap) với row khác
-- nhưng CHỈ áp dụng cho row đang "active" (chưa cancel/release)
ALTER TABLE room_booking_usages
  ADD CONSTRAINT no_overlap_booking
  EXCLUDE USING GIST (
    room_id WITH =,
    reserved_range WITH &&
  )
  WHERE (usage_status NOT IN ('CANCELLED', 'AUTO_RELEASED', 'MANUAL_RELEASED'));

-- Test thử
INSERT INTO room_booking_usages (room_id, reserved_start, reserved_end, usage_status)
  VALUES (1, '2026-06-10 14:00+07', '2026-06-10 15:00+07', 'RESERVED');
-- Second insert overlap → throw 23P01
INSERT INTO room_booking_usages (room_id, reserved_start, reserved_end, usage_status)
  VALUES (1, '2026-06-10 14:30+07', '2026-06-10 15:30+07', 'RESERVED');
-- ERROR: conflicting key value violates exclusion constraint "no_overlap_booking"
```

### D.5.2. ESLint Module Boundaries

```json
// .eslintrc.json (root)
{
  "plugins": ["boundaries"],
  "settings": {
    "boundaries/elements": [
      { "type": "controller", "pattern": "src/modules/*/controllers/*" },
      { "type": "service",    "pattern": "src/modules/*/services/*" },
      { "type": "repository", "pattern": "src/modules/*/repositories/*" },
      { "type": "dto",        "pattern": "src/modules/*/dto/*" }
    ]
  },
  "rules": {
    "boundaries/element-types": ["error", {
      "default": "disallow",
      "rules": [
        { "from": "controller", "allow": ["service", "dto"] },
        { "from": "service",    "allow": ["service", "repository", "dto"] },
        { "from": "repository", "allow": ["dto"] }
      ]
    }],
    "boundaries/no-private": "error"
  }
}
```

### D.5.3. Outbox Worker (đầy đủ)

```typescript
// apps/backend/src/modules/notification/workers/outbox.worker.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../infra/prisma.service';
import { MailerService } from '../mailer.service';

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick() {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM email_outbox
        WHERE status IN ('PENDING', 'RETRY')
          AND next_retry_at <= now()
        ORDER BY next_retry_at
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `;
      if (!rows.length) return;

      for (const row of rows) {
        await tx.email_outbox.update({
          where: { id: row.id },
          data: { status: 'SENDING', attempts: row.attempts + 1 },
        });

        try {
          await this.mailer.send({
            to: row.recipient,
            template: row.template,
            data: row.payload_json,
            headers: { 'X-Idempotency-Key': row.idempotency_key },
          });
          await tx.email_outbox.update({
            where: { id: row.id },
            data: { status: 'SENT', sent_at: new Date() },
          });
        } catch (e: any) {
          const newAttempts = row.attempts + 1;
          const isFinal = newAttempts >= row.max_attempts;
          const delayMs = Math.min(2 ** row.attempts * 60_000, 30 * 60_000);
          await tx.email_outbox.update({
            where: { id: row.id },
            data: {
              status: isFinal ? 'DEAD' : 'RETRY',
              last_error: String(e?.message ?? e),
              next_retry_at: new Date(Date.now() + delayMs),
            },
          });
          this.logger.warn(`Outbox ${row.id} retry attempt ${newAttempts}: ${e.message}`);
        }
      }
    });
  }
}
```

### D.5.4. Signed URL Builder (Recording playback)

```typescript
// apps/backend/src/modules/recording/services/playback-url.service.ts
import { Injectable } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class PlaybackUrlService {
  constructor(private audit: AuditService) {}

  async buildPlaybackUrl(file: { id: number; s3_key: string; duration_sec: number | null },
                         viewerId: number): Promise<string> {
    const durationSec = file.duration_sec ?? 3600;
    // TTL = duration × 1.5 + 30 phút buffer, clamp [1h, 4h]
    const ttlSec = Math.min(
      Math.max(Math.ceil(durationSec * 1.5) + 1800, 3600),
      14400,
    );

    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.RECORDING_BUCKET!,
        Key: file.s3_key,
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: ttlSec },
    );

    await this.audit.log({
      actor_id: viewerId,
      action: 'RECORDING_VIEW',
      entity: 'media_files',
      entity_id: file.id,
      after_json: { ttl_sec: ttlSec },
    });

    return url;
  }

  async buildDownloadUrl(file: { id: number; s3_key: string; file_name: string },
                          viewerId: number): Promise<string> {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.RECORDING_BUCKET!,
        Key: file.s3_key,
        ResponseContentDisposition: `attachment; filename="${file.file_name}"`,
      }),
      { expiresIn: 300 }, // 5 phút cho download
    );
    await this.audit.log({
      actor_id: viewerId, action: 'RECORDING_DOWNLOAD',
      entity: 'media_files', entity_id: file.id,
    });
    return url;
  }
}
```

### D.5.5. BullMQ Job với deterministic jobId (cho dismiss-able auto-release)

```typescript
// apps/backend/src/modules/no-show/services/no-show.service.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class NoShowService {
  constructor(@InjectQueue('auto-release') private queue: Queue) {}

  async scheduleAutoRelease(noShowLogId: number, graceMinutes: number) {
    const jobId = `auto-release:${noShowLogId}`;
    // jobId trùng → BullMQ tự dedupe, không schedule trùng
    await this.queue.add(
      'auto-release',
      { noShowLogId },
      {
        jobId,
        delay: graceMinutes * 60_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async cancelAutoRelease(noShowLogId: number) {
    const jobId = `auto-release:${noShowLogId}`;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }
}
```

### D.5.6. Refresh Token Revocation Pattern

```typescript
// Khi user đổi password:
async changePassword(userId: number, newPassword: string) {
  return this.prisma.$transaction(async (tx) => {
    const passwordChangedAt = new Date();
    await tx.users.update({
      where: { id: userId },
      data: {
        password_hash: await bcrypt.hash(newPassword, 12),
        password_changed_at: passwordChangedAt,
      },
    });
    // Không cần UPDATE N rows refresh_tokens
    // Logic validate sẽ check token.issued_at >= user.password_changed_at
  });
}

// Khi validate refresh token:
async validateRefreshToken(jti: string, userId: number): Promise<boolean> {
  const [token, user] = await Promise.all([
    this.prisma.refresh_tokens.findUnique({ where: { jti } }),
    this.prisma.users.findUnique({ where: { id: userId } }),
  ]);
  if (!token || !user) return false;
  if (token.revoked_at) return false;
  if (token.expires_at < new Date()) return false;
  // Key check: token phải được issue AFTER lần đổi password gần nhất
  if (user.password_changed_at && token.issued_at < user.password_changed_at) {
    return false;
  }
  return true;
}
```

### D.5.7. HMAC Verification cho IoT ingestion

```typescript
// apps/backend/src/modules/iot/guards/hmac.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class HmacGuard implements CanActivate {
  constructor(private deviceService: DeviceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const deviceCode = req.headers['x-device-code'];
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];

    if (!deviceCode || !signature || !timestamp) {
      throw new UnauthorizedException('Missing HMAC headers');
    }
    // Chống replay: timestamp lệch quá 5 phút → reject
    if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) {
      throw new UnauthorizedException('Timestamp out of range');
    }

    const device = await this.deviceService.findByCode(deviceCode);
    if (!device) throw new UnauthorizedException('Unknown device');

    const secret = await this.deviceService.decryptSecret(device.hmac_secret_encrypted);
    const rawBody = req.rawBody; // bodyParser config preserve raw
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      throw new UnauthorizedException('Invalid signature');
    }
    req.device = device;
    return true;
  }
}
```

## D.6. Lời kết

Tài liệu này là **bản kế hoạch và kiến trúc v2.0** cho SMRMPTS, được biên soạn ở cương vị Business Analyst + Solution Architect và đã trải qua review chéo với 3 vai trò Senior Dev / Architect / BA. Phiên bản v2.0 bổ sung 20 cải tiến quan trọng so với v1.0:

1. Quy tắc giao tiếp module + decision matrix EventEmitter/BullMQ
2. WebSocket scaling decision với Redis adapter từ S1
3. Capacity planning có math thật
4. Outbox pattern đầy đủ với DLQ + idempotency
5. Conflict detection bằng EXCLUDE constraint (atomic ở DB)
6. Recording lifecycle cứng với orphan recovery
7. BullMQ idempotency cho dismiss flow
8. Refresh token revocation flow đầy đủ
9. Signed URL TTL dynamic theo duration
10. Rate limit + circuit breaker cho ingestion
11. RPO/RTO + restore drill bắt buộc
12. Manager vs Approver role rõ ràng
13. Booking approval rules cụ thể
14. Recording consent flow (BR-PRIV-01)
15. Right-to-be-forgotten qua anonymize
16. No-show definition chính xác (BR-NS-01)
17. Meeting overrun policy
18. Acceptance Criteria Gherkin cho 5 UC critical
19. Plan B 5-dev fallback
20. Business Rules tách thành section riêng (§B.5)

**Cấu trúc 4 phần** vẫn giữ nguyên: **(A)** kiến trúc — modular monolith + 2 microservice nhỏ; **(B)** UC catalog với MoSCoW (32 MUST + 20 SHOULD + 11 COULD + 6 WON'T) + Business Rules đầy đủ; **(C)** kế hoạch 8 sprint với DoD chặt và 17 risk được theo dõi; **(D)** phụ lục với glossary và reference code.

**Khuyến nghị cuối:** Tổ chức buổi họp scope-lock với lecturer trong tuần đầu Sprint 0 để confirm 8 BR ở §B.5.7 và 8 câu Q1-Q8 ở §C.6. Một khi đã ký, không thay đổi lớn cho tới M3, trừ khi có lý do bất khả kháng.

Tài liệu được lưu giữ trong repo `docs/spec.md`, mọi sửa đổi sau này phải đi kèm PR với approval của Tech Lead.

---

**— End of Spec v2.0 —**
