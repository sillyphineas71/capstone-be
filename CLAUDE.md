# CLAUDE.md - [Smart Meeting Management & AI Meeting Intelligence Platform] v1.0

## TL;DR (Đọc trước - 60 giây)

> Đây là nền tảng quản lý toàn bộ vòng đời cuộc họp cho doanh nghiệp/tổ chức:
> tạo cuộc họp, duyệt yêu cầu, kiểm tra xung đột lịch, đặt phòng, quản lý thiết bị,
> điểm danh/presence, điều khiển cuộc họp, ghi âm/ghi hình, AI transcript/summary,
> action items, báo cáo, và kho tri thức cuộc họp có thể tìm kiếm.
> Đây KHÔNG chỉ là app lịch họp.
> Đây cũng KHÔNG chỉ là app AI note-taking.
> Đây là hệ thống vận hành nội bộ cho meeting lifecycle end-to-end.

> Giá trị cốt lõi:
> - Giảm thao tác thủ công khi tạo và điều phối họp
> - Giảm lãng phí phòng họp, no-show, phantom booking
> - Tăng khả năng kiểm soát, phê duyệt, audit
> - Biến nội dung họp thành tri thức có thể tái sử dụng

> Backend: Nestjs + PostgreSQL. Frontend: React + TypeScript

## KIẾN TRÚC HỆ THỐNG

### Các module chính:

| Module | Vai trò | Repo |
|---|---|---|
| auth | Xác thực và phân quyền | /src/modules/auth |
| accounts | Quản lý tài khoản, hồ sơ người dùng | /src/modules/accounts |
| meetings | Tạo/cập nhật/hủy/xem cuộc họp | /src/modules/meetings |    
| approvals | Duyệt yêu cầu họp, ad-hoc/emergency approval | /src/modules/approvals |
| scheduling | Conflict checking, time suggestion | /src/modules/scheduling |
| rooms | Quản lý phòng họp | /src/modules/rooms |
| equipment | Quản lý thiết bị phòng họp | /src/modules/equipment |
| attendance | Check-in/check-out, attendance log | /src/modules/attendance |
| presence | Presence detection, face/presence signals | /src/modules/presence |
| utilization | No-show, early vacancy, auto-release room | /src/modules/utilization |
| live-meeting | Start/pause/resume/extend/end meeting | /src/modules/live-meeting |
| recording | Ghi âm/ghi hình và media association | /src/modules/recording |
| ai-processing | Transcript, summary, decisions, action items | /src/modules/ai-processing |
| minutes | Quản lý biên bản / minutes | /src/modules/minutes |
| knowledge | Tìm kiếm và lưu trữ tri thức cuộc họp | /src/modules/knowledge |
| notifications | Email/reminder/outcome notification | /src/modules/notifications |
| tasks | Follow-up task management | /src/modules/tasks |
| analytics | Dashboard, KPI, room utilization analytics | /src/modules/analytics |
| administration | Cấu hình hệ thống, policy, audit | /src/modules/administration |

## CẤU TRÚC SPEC / SPEC HIERARCHY

Toàn bộ tài liệu đặc tả (specification) của dự án được lưu trong thư mục:

`/spec`

Thư mục `spec/` là nguồn sự thật chính cho phần đặc tả nghiệp vụ, kiến trúc, ràng buộc và kế hoạch triển khai.  
`src/` là nơi chứa mã nguồn triển khai.  
Không đặt logic đặc tả chính thức bên trong `src/`; mọi rule, boundary và implementation intent phải được định nghĩa trong `spec/` trước, sau đó mới được hiện thực trong code.

### Cấu trúc spec của dự án

```text
/spec
  /global
    constitution.md
    system-arch.md
    security.md
    data-governance.md

  /modules
    /auth
      module.md
      arch.md
      api.md
    /accounts
      module.md
      arch.md
      api.md
    /meetings
      module.md
      arch.md
      api.md
    /approvals
      module.md
      arch.md
      api.md
    /scheduling
      module.md
      arch.md
      api.md
    /rooms
      module.md
      arch.md
      api.md
    /equipment
      module.md
      arch.md
      api.md
    /attendance
      module.md
      arch.md
      api.md
    /presence
      module.md
      arch.md
      api.md
    /utilization
      module.md
      arch.md
      api.md
    /live-meeting
      module.md
      arch.md
      api.md
    /recording
      module.md
      arch.md
      api.md
    /ai-processing
      module.md
      arch.md
      api.md
    /minutes
      module.md
      arch.md
      api.md
    /knowledge
      module.md
      arch.md
      api.md
    /notifications
      module.md
      arch.md
      api.md
    /tasks
      module.md
      arch.md
      api.md
    /analytics
      module.md
      arch.md
      api.md
    /administration
      module.md
      arch.md
      api.md

  /features
    /feat-login
      SPEC.md
      PLAN.md
      TASKS.md
    /feat-create-meeting
      SPEC.md
      PLAN.md
      TASKS.md
    /feat-approve-meeting
      SPEC.md
      PLAN.md
      TASKS.md
    /feat-room-booking
      SPEC.md
      PLAN.md
      TASKS.md
    /feat-attendance-tracking
      SPEC.md
      PLAN.md
      TASKS.md
    ...