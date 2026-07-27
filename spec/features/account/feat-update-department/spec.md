# DEPT-UPD-001 — BE-08: Cập nhật phòng ban (PATCH /departments/:id)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo spec BE-08 (PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md §3A). Code + test xong cùng lượt. | Toàn bộ |

## 1. Bối cảnh

`DepartmentsController`/`DepartmentsService` (module `accounts`) đã có `POST /departments` (tạo) và `GET /departments` (list). Thiếu endpoint sửa. Entity `DepartmentEntity` có sẵn đủ field cần cho update: `departmentCode`, `departmentName`, `parentDepartmentId`, `managerUserId`, `description`, `isActive`, `updatedBy`, `deletedAt`.

## 2. Quyết định thiết kế

1. **`departmentCode` KHÔNG được sửa** — mã định danh, nếu team muốn cho sửa phải là UC riêng (ảnh hưởng các bảng tham chiếu bằng mã).
2. **KHÔNG dùng `@Validate(IsDepartmentNameUniqueConstraint)` trên `UpdateDepartmentDto`** — khác với `CreateDepartmentDto`. Lý do: validator đó check tồn tại tên trong toàn bảng, KHÔNG loại trừ được chính bản ghi đang sửa → PATCH gửi lại đúng tên hiện tại (không đổi tên, chỉ đổi field khác) sẽ bị từ chối nhầm là trùng. Tính duy nhất tên khi update được kiểm tra trực tiếp trong `DepartmentsService.updateDepartment()`, có so sánh `existingName.id !== id` để loại trừ chính nó, VÀ chỉ chạy khi tên thực sự đổi (`sanitized !== dept.departmentName`).
3. **Chặn chu trình cha-con**: `wouldCreateCycle(em, currentId, candidateParentId)` duyệt ngược từ `candidateParentId` lên tổ tiên; nếu gặp lại `currentId` → chu trình → `422`. Bao gồm cả trường hợp tự làm cha của chính mình (`candidateParentId === currentId`, phát hiện ngay bước đầu vòng lặp — nhưng code check tường minh riêng trước để trả lỗi rõ ràng hơn).
4. **Giữ nguyên rule độ sâu tối đa 5 cấp** khi đổi cha — tái dùng `calcDepth()` có sẵn từ `createDepartment`, cùng rule với tạo mới (đổi cha không được làm cây vượt quá `MAX_DEPTH=5`).
5. **Body rỗng (mọi field `undefined`) → 400 `EMPTY_UPDATE_PAYLOAD`** — mirror pattern `MeetingUpdateService` (BE-03, P0).
6. **`parentDepartmentId`/`managerUserId` chấp nhận `null` tường minh** để xóa liên kết (gỡ cha/gỡ quản lý) — khác `undefined` (không đổi).
7. **Không re-query DB sau `em.update()`** — response dựng từ state đã tính trong transaction (department + field mới) để tránh phụ thuộc round-trip DB thứ hai không cần thiết trong cùng transaction.

## 3. Scope

### Trong scope
- `PATCH /api/v1/departments/:id` — `departmentName?`, `parentDepartmentId?`, `managerUserId?`, `description?`, `isActive?` (tất cả optional).
- Validate: 404 department không tồn tại/đã xóa mềm; 409 tên trùng (loại trừ chính nó); 404 parent/manager không tồn tại hoặc không active; 422 chu trình cha-con; 422 vượt quá 5 cấp; 400 body rỗng.
- Transaction + `updated_by` + audit log (`actionType='update'`, `entityType='department'`, `oldValueJson`/`newValueJson`).
- Permission `department.update`, seed migration riêng, role giống `department.create` (`MANAGER`, `SYSTEM_ADMIN`).

### Ngoài scope
- Sửa `departmentCode`.
- Xóa mềm/khôi phục phòng ban (không có trong yêu cầu BE-08).
- Đổi hàng loạt (bulk update).

## 4. Requirements (EARS)

- **R1**: **WHEN** body không có field nào **→** `400 EMPTY_UPDATE_PAYLOAD`.
- **R2**: **WHEN** `id` không tồn tại hoặc đã xóa mềm **→** `404 DEPARTMENT_NOT_FOUND`.
- **R3**: **WHEN** đổi `departmentName` thành tên đã tồn tại ở phòng ban KHÁC **→** `409 DEPARTMENT_ALREADY_EXISTS`.
- **R4**: **WHEN** gửi lại đúng `departmentName` hiện tại (không đổi) **→** KHÔNG bị coi là trùng, cập nhật bình thường.
- **R5 (crux)**: **WHEN** `parentDepartmentId` mới là chính `id` hoặc là hậu duệ của `id` **→** `422 VALIDATION_ERROR` (chặn chu trình).
- **R6**: **WHEN** `parentDepartmentId` mới làm độ sâu cây > 5 cấp **→** `422 VALIDATION_ERROR`.
- **R7**: **WHEN** `parentDepartmentId`/`managerUserId` mới không tồn tại hoặc không active **→** `404 RESOURCE_NOT_FOUND`.
- **R8**: **WHEN** `parentDepartmentId`/`managerUserId` = `null` **→** gỡ liên kết (set NULL), không lỗi.
- **R9**: **WHERE** người dùng không có permission `department.update` **→** `403`.

## 5. Constitution

- **ARCH-01**: Logic nằm trong `DepartmentsService.updateDepartment()`, cùng service với `createDepartment`/`listDepartments` — KHÔNG tách service riêng (department chỉ ~300 dòng, chưa cần tách theo §15 CLAUDE.md).
- **DATA-01**: Transaction bắt buộc (đọc-kiểm tra-ghi nhiều bước).
- **SEC-01**: `@RequirePermissions('department.update')`, `forbidNonWhitelisted: true` (chặn field lạ, vd cố gửi `departmentCode`).
- **AUDIT-01**: Ghi `audit_logs` mọi lần update thành công (best-effort, lỗi audit không rollback transaction — mirror `createDepartment`).

## 6. Residuals / known-gaps

- Đổi `managerUserId` không kiểm tra manager có thuộc phòng ban này hay phòng ban khác — chấp nhận (không có rule nào trong SRS yêu cầu quản lý phải cùng phòng ban).
- Không có event/notification khi đổi cha phòng ban (ảnh hưởng cây tổ chức) — ngoài phạm vi BE-08, có thể bổ sung sau nếu team yêu cầu.
