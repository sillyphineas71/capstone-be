# Spec Template - Feature Specification

> File này dùng làm template cho Spec Kit / Codex CLI khi chạy `$speckit-specify`.
> Mục tiêu: tạo đặc tả tính năng rõ ràng, dễ kiểm tra, dễ chuyển tiếp sang plan/tasks/implementation.
>
> Ngôn ngữ chính: Tiếng Việt.
> Tên riêng, tên module, tên bảng, tên API, công nghệ, framework có thể giữ tiếng Anh khi cần rõ nghĩa.
>
> Quy tắc quan trọng:
> - Spec tập trung vào **WHAT** và **WHY**, chưa đi sâu vào **HOW**.
> - Không tự ý thêm feature ngoài tài liệu nguồn.
> - Không tự ý thêm bảng database mới nếu chưa có yêu cầu rõ ràng.
> - Nếu thiếu thông tin, ghi vào cuối phần liên quan dưới dạng `Cần làm rõ`.
> - Functional Requirements phải viết theo phong cách **EARS Requirements**.
> - Mỗi requirement phải có mã định danh rõ ràng để trace về plan, task, test case.

---

# Feature Specification: [FEATURE_NAME]

- **Feature ID**: [Ví dụ: MEETING-001]
- **Feature Name**: [Tên tính năng]
- **Module / Domain**: [Ví dụ: meetings, rooms, attendance, recording]
- **Created Date**: [YYYY-MM-DD]
- **Status**: Draft
- **Source Documents**:
  - [Tên tài liệu / file nguồn 1]
  - [Tên tài liệu / file nguồn 2]
  - [Tên tài liệu / file nguồn 3]

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo các mẫu EARS sau:

### 1. Ubiquitous Requirement

Dùng cho yêu cầu luôn đúng trong mọi trường hợp.

```text
FR-XXX: Hệ thống phải [hành vi bắt buộc].
```

Ví dụ:

```text
FR-001: Hệ thống phải lưu lại thông tin người tạo cuộc họp cho mỗi cuộc họp được tạo mới.
```

### 2. Event-driven Requirement

Dùng khi hệ thống phản ứng sau một sự kiện.

```text
FR-XXX: Khi [sự kiện xảy ra], hệ thống phải [phản hồi/hành vi].
```

Ví dụ:

```text
FR-002: Khi người dùng gửi yêu cầu tạo cuộc họp, hệ thống phải kiểm tra xung đột lịch của phòng họp được chọn.
```

### 3. State-driven Requirement

Dùng khi hành vi chỉ xảy ra trong một trạng thái cụ thể.

```text
FR-XXX: Trong khi [trạng thái/điều kiện đang đúng], hệ thống phải [hành vi].
```

Ví dụ:

```text
FR-003: Trong khi cuộc họp đang ở trạng thái in_progress, hệ thống phải cho phép host kết thúc cuộc họp.
```

### 4. Optional Feature Requirement

Dùng khi yêu cầu chỉ áp dụng nếu hệ thống có một capability hoặc cấu hình cụ thể.

```text
FR-XXX: Nếu [capability/cấu hình tồn tại], hệ thống phải [hành vi].
```

Ví dụ:

```text
FR-004: Nếu phòng họp có thiết bị ghi âm được cấu hình, hệ thống phải cho phép host bắt đầu recording session.
```

### 5. Unwanted Behavior Requirement

Dùng cho lỗi, ngoại lệ, hoặc hành vi không mong muốn.

```text
FR-XXX: Nếu [điều kiện lỗi/không hợp lệ], hệ thống phải [cách xử lý an toàn].
```

Ví dụ:

```text
FR-005: Nếu người dùng không có quyền tạo cuộc họp, hệ thống phải từ chối yêu cầu và trả về thông báo lỗi phù hợp.
```

---

## 1. Context & Goal

### 1.1 Bối cảnh

[Mô tả bối cảnh nghiệp vụ của tính năng. Giải thích vì sao tính năng này cần tồn tại trong hệ thống.]

Gợi ý cần làm rõ:

- Tính năng này thuộc module nào?
- Vấn đề hiện tại là gì?
- Tính năng này phục vụ phần nào trong meeting lifecycle?
- Tính năng này liên quan tới feature/use case nào trong tài liệu nguồn?

### 1.2 Mục tiêu

[Mô tả mục tiêu chính của tính năng.]

Ví dụ format:

```text
Mục tiêu của tính năng này là cho phép [actor] thực hiện [hành động/nghiệp vụ] nhằm [giá trị mang lại].
```

### 1.3 Giá trị mang lại

- [Giá trị cho người dùng]
- [Giá trị cho admin/quản trị hệ thống]
- [Giá trị cho vận hành/phòng họp/thiết bị]
- [Giá trị cho dữ liệu/báo cáo nếu có]

### 1.4 Giả định

- [Giả định 1]
- [Giả định 2]
- [Giả định 3]

### 1.5 Cần làm rõ

- [Câu hỏi cần làm rõ nếu thiếu thông tin]
- [Không tự bịa nếu tài liệu nguồn chưa nói rõ]

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| [Actor 1] | [Mô tả vai trò] | [Quyền/trách nhiệm] |
| [Actor 2] | [Mô tả vai trò] | [Quyền/trách nhiệm] |
| [Actor 3] | [Mô tả vai trò] | [Quyền/trách nhiệm] |

### 2.2 Role & Permission Rules

- [Role nào được phép thực hiện action nào]
- [Role nào chỉ được xem dữ liệu]
- [Role nào được duyệt/từ chối/cấu hình/quản trị]
- [Các giới hạn theo phòng ban, owner, participant, admin scope nếu có]

### 2.3 Actor Constraints

- [Điều kiện actor phải thỏa trước khi dùng tính năng]
- [Ví dụ: phải đăng nhập, phải có role, phải thuộc department, phải là host, phải là admin]

---

## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Mỗi requirement phải rõ ràng, kiểm thử được, không mơ hồ.
> Tránh các từ mơ hồ như: nhanh, tốt, tiện lợi, tối ưu, thông minh nếu không có tiêu chí đo lường.

### 3.1 Core Requirements

```text
FR-001: Hệ thống phải [hành vi bắt buộc cốt lõi].
FR-002: Khi [sự kiện xảy ra], hệ thống phải [phản hồi/hành vi].
FR-003: Trong khi [trạng thái/điều kiện đang đúng], hệ thống phải [hành vi].
FR-004: Nếu [điều kiện/capability tồn tại], hệ thống phải [hành vi].
FR-005: Nếu [điều kiện lỗi/không hợp lệ], hệ thống phải [xử lý lỗi an toàn].
```

### 3.2 Workflow Requirements

```text
FR-006: Khi [actor] bắt đầu [quy trình], hệ thống phải [bước xử lý đầu tiên].
FR-007: Khi [bước nghiệp vụ hoàn tất], hệ thống phải [chuyển trạng thái / lưu dữ liệu / thông báo].
FR-008: Nếu [quy trình cần phê duyệt], hệ thống phải [tạo yêu cầu phê duyệt / cập nhật trạng thái].
```

### 3.3 Authorization Requirements

```text
FR-009: Nếu người dùng chưa đăng nhập, hệ thống phải từ chối truy cập vào tính năng này.
FR-010: Nếu người dùng không có quyền [permission], hệ thống phải từ chối yêu cầu và không thay đổi dữ liệu.
FR-011: Khi người dùng thực hiện hành động quan trọng, hệ thống phải kiểm tra quyền trước khi xử lý nghiệp vụ.
```

### 3.4 Data & State Requirements

```text
FR-012: Khi dữ liệu hợp lệ được gửi lên, hệ thống phải lưu dữ liệu theo trạng thái ban đầu phù hợp.
FR-013: Khi trạng thái của [entity] thay đổi, hệ thống phải ghi nhận thời điểm thay đổi.
FR-014: Nếu [entity] đã ở trạng thái cuối, hệ thống phải không cho phép cập nhật trái quy trình.
```

### 3.5 Notification / Audit Requirements

```text
FR-015: Khi [sự kiện quan trọng] xảy ra, hệ thống phải tạo thông báo cho [actor liên quan].
FR-016: Khi [actor] thực hiện hành động quan trọng, hệ thống phải ghi audit log với actor, hành động, thời gian và đối tượng liên quan.
```

### 3.6 Integration Requirements

```text
FR-017: Nếu tính năng phụ thuộc vào module [module name], hệ thống phải kiểm tra dữ liệu liên quan trước khi hoàn tất nghiệp vụ.
FR-018: Nếu dịch vụ tích hợp bên ngoài không phản hồi, hệ thống phải ghi nhận lỗi và trả về trạng thái phù hợp thay vì làm hỏng dữ liệu chính.
```

### 3.7 Traceability

| Requirement ID | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|
| FR-001 | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-002 | [Use case / tài liệu nguồn] | [Ghi chú] |
| FR-003 | [Use case / tài liệu nguồn] | [Ghi chú] |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: Hệ thống phải phản hồi các thao tác chính trong vòng [X] giây trong điều kiện tải thông thường.
NFR-002: Hệ thống phải xử lý tối thiểu [N] yêu cầu đồng thời cho tính năng này nếu tài liệu nguồn có yêu cầu.
```

### 4.2 Security

```text
NFR-003: Hệ thống phải yêu cầu xác thực trước khi cho phép truy cập dữ liệu của tính năng này.
NFR-004: Hệ thống phải kiểm tra phân quyền cho mọi thao tác thay đổi dữ liệu.
NFR-005: Hệ thống phải không trả về dữ liệu nhạy cảm không cần thiết trong response.
```

### 4.3 Reliability & Consistency

```text
NFR-006: Hệ thống phải đảm bảo dữ liệu không bị cập nhật một phần khi thao tác nghiệp vụ thất bại.
NFR-007: Hệ thống phải giữ trạng thái dữ liệu nhất quán giữa các entity liên quan.
```

### 4.4 Usability

```text
NFR-008: Hệ thống phải trả về thông báo lỗi rõ ràng để client có thể hiển thị cho người dùng.
NFR-009: Hệ thống phải sử dụng tên trường và response format nhất quán với API convention của dự án.
```

### 4.5 Observability

```text
NFR-010: Hệ thống phải ghi log cho các lỗi quan trọng trong quá trình xử lý tính năng.
NFR-011: Hệ thống phải ghi audit log cho các thao tác có ảnh hưởng đến dữ liệu nghiệp vụ quan trọng.
```

### 4.6 Maintainability

```text
NFR-012: Logic nghiệp vụ của tính năng phải được tách theo module/domain phù hợp.
NFR-013: Tính năng phải có test case cho luồng thành công, luồng lỗi và phân quyền chính.
```

---

## 5. Data Model

> Phần này mô tả dữ liệu ở mức nghiệp vụ.
> Không tự ý thêm bảng mới nếu database baseline chưa có.
> Nếu cần bảng/cột mới, phải ghi rõ là đề xuất và đưa vào `Cần làm rõ`.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| [table/entity 1] | [Mô tả vai trò] | [Ghi chú] |
| [table/entity 2] | [Mô tả vai trò] | [Ghi chú] |
| [table/entity 3] | [Mô tả vai trò] | [Ghi chú] |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| [field_1] | [string/uuid/date/boolean/etc.] | Có/Không | [Mô tả] | [Rule] |
| [field_2] | [string/uuid/date/boolean/etc.] | Có/Không | [Mô tả] | [Rule] |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| [field_1] | [type] | [Mô tả] |
| [field_2] | [type] | [Mô tả] |

### 5.4 State / Status Model

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| [status_1] | [Mô tả] | [status_2] | [Điều kiện] |
| [status_2] | [Mô tả] | [status_3] | [Điều kiện] |

### 5.5 Data Constraints

- [Ràng buộc dữ liệu 1]
- [Ràng buộc dữ liệu 2]
- [Unique constraint / foreign key / ownership rule nếu có]
- [Quy tắc không được xóa nếu đã có dữ liệu liên quan nếu có]

### 5.6 Data Lifecycle

- [Khi nào dữ liệu được tạo]
- [Khi nào dữ liệu được cập nhật]
- [Khi nào dữ liệu được hủy/xóa mềm]
- [Khi nào dữ liệu được dùng cho báo cáo/audit]

### 5.7 Cần làm rõ

- [Bảng/cột nào chưa chắc chắn]
- [Quan hệ dữ liệu nào cần xác nhận]
- [Có cần thêm field/table không, nếu tài liệu nguồn chưa đủ]

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: Nếu [field] bị thiếu, hệ thống phải từ chối yêu cầu và trả về lỗi validation.
ERR-002: Nếu [field] không đúng định dạng, hệ thống phải từ chối yêu cầu và trả về lỗi validation.
ERR-003: Nếu [field] vượt giới hạn cho phép, hệ thống phải từ chối yêu cầu và trả về lỗi validation.
```

### 6.2 Authorization Errors

```text
ERR-004: Nếu người dùng chưa đăng nhập, hệ thống phải trả về lỗi xác thực.
ERR-005: Nếu người dùng không có quyền thực hiện hành động, hệ thống phải trả về lỗi phân quyền.
```

### 6.3 Business Rule Errors

```text
ERR-006: Nếu yêu cầu vi phạm business rule [tên rule], hệ thống phải từ chối yêu cầu và trả về lỗi nghiệp vụ phù hợp.
ERR-007: Nếu đối tượng đang ở trạng thái không cho phép thao tác, hệ thống phải từ chối yêu cầu và không thay đổi dữ liệu.
```

### 6.4 Conflict Errors

```text
ERR-008: Nếu thao tác gây xung đột với dữ liệu hiện có, hệ thống phải từ chối yêu cầu và trả về thông tin xung đột cần thiết.
ERR-009: Nếu dữ liệu đã bị thay đổi bởi thao tác khác, hệ thống phải xử lý theo quy tắc concurrency của dự án.
```

### 6.5 Integration / Device / External Service Errors

```text
ERR-010: Nếu service/module phụ thuộc không phản hồi, hệ thống phải ghi log lỗi và trả về lỗi phù hợp.
ERR-011: Nếu thiết bị IoT/capture/device không khả dụng, hệ thống phải không làm hỏng dữ liệu nghiệp vụ chính.
```

### 6.6 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code hoặc mã lỗi tương ứng |
| `message` | Thông báo lỗi có thể hiển thị/diễn giải |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ nếu dự án có convention |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path nếu áp dụng |

---

## 7. Acceptance Criteria

> Acceptance Criteria phải kiểm thử được.
> Ưu tiên format Given / When / Then.

### 7.1 Happy Path

```text
AC-001:
Given [bối cảnh hợp lệ],
When [actor thực hiện hành động],
Then [kết quả mong đợi phải xảy ra].
```

### 7.2 Validation Cases

```text
AC-002:
Given [dữ liệu thiếu hoặc không hợp lệ],
When [actor gửi yêu cầu],
Then hệ thống phải từ chối yêu cầu và trả về lỗi validation phù hợp.
```

### 7.3 Authorization Cases

```text
AC-003:
Given [actor không có quyền],
When [actor thực hiện hành động bị giới hạn],
Then hệ thống phải từ chối yêu cầu và không thay đổi dữ liệu.
```

### 7.4 Business Rule Cases

```text
AC-004:
Given [dữ liệu/trạng thái vi phạm business rule],
When [actor thực hiện hành động],
Then hệ thống phải từ chối yêu cầu và trả về lỗi nghiệp vụ phù hợp.
```

### 7.5 State Transition Cases

```text
AC-005:
Given [entity đang ở trạng thái A],
When [sự kiện hợp lệ xảy ra],
Then hệ thống phải chuyển entity sang trạng thái B và ghi nhận thời điểm thay đổi.
```

### 7.6 Audit / Notification Cases

```text
AC-006:
Given [hành động quan trọng được thực hiện thành công],
When hệ thống hoàn tất xử lý,
Then hệ thống phải ghi audit log và/hoặc tạo notification cho actor liên quan nếu được yêu cầu.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002 | [Mô tả test] |
| AC-002 | FR-005, ERR-001 | [Mô tả test] |
| AC-003 | FR-009, FR-010 | [Mô tả test] |

---

## 8. Out of Scope

> Phần này rất quan trọng để agent không tự mở rộng feature.

Các nội dung sau **không thuộc phạm vi** của feature này:

- [Nội dung không làm 1]
- [Nội dung không làm 2]
- [Nội dung không làm 3]
- [Phần integration chưa triển khai nếu có]
- [Phần AI/automation/reporting nâng cao nếu chưa được yêu cầu]

### 8.1 Không triển khai trong feature này

- [Không implement API/logic nào]
- [Không xử lý module nào]
- [Không thêm bảng/cột nào]
- [Không tạo luồng nghiệp vụ nào]

### 8.2 Có thể xem xét ở feature khác

- [Ý tưởng hoặc phạm vi có thể tách sang feature khác]
- [Các enhancement sau này]
- [Các tích hợp phụ thuộc vào thiết bị/service khác]

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [ ] Spec đã có đủ 8 thành phần chính.
- [ ] Functional Requirements đã viết theo EARS.
- [ ] Mỗi requirement có mã ID rõ ràng.
- [ ] Requirement có thể kiểm thử được.
- [ ] Không mô tả quá sâu implementation.
- [ ] Không tự ý thêm feature ngoài tài liệu nguồn.
- [ ] Không tự ý thêm database table/field mới nếu chưa có căn cứ.
- [ ] Error handling đã bao gồm validation, authorization, business rule và conflict.
- [ ] Acceptance Criteria dùng Given / When / Then.
- [ ] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [ ] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ`.