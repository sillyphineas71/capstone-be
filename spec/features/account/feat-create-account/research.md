# Research: UC-AM-01 Create New Account

## 1. API contract shape for single-role creation

- Decision: Dùng `roleId` thay cho `roleIds` trong feature-level contract của UC-AM-01.
- Rationale: Clarification đã chốt mỗi account mới chỉ có 1 role chính tại thời điểm tạo; `roleIds` dễ tạo ambiguity và kéo validation ngoài scope.
- Alternatives considered:
  - Giữ `roleIds` nhưng ép đúng 1 phần tử: tương thích ngược tốt hơn nhưng kém rõ ràng.
  - Cho phép nhiều role: trái clarification và mở rộng scope.

## 2. Username uniqueness strategy

- Decision: Generate `username` theo `short_name_base + random_4_digits`, retry tối đa 10 lần, sau đó fail với `USERNAME_GENERATION_FAILED`.
- Rationale: Phù hợp clarification và đủ đơn giản để implement/test; DB unique constraint vẫn là nguồn sự thật cuối cùng.
- Alternatives considered:
  - Dùng sequence/timestamp dài hơn: giảm collision nhưng làm lệch spec đã chốt.
  - Generate một lần rồi fail ngay: tăng xác suất lỗi không cần thiết.

## 3. Transaction boundary

- Decision: Đặt `users`, `user_roles`, `audit_logs` trong cùng DB transaction; email nằm ngoài transaction sau commit.
- Rationale: Đảm bảo atomicity cho dữ liệu cốt lõi nhưng không làm email provider ảnh hưởng account creation success path.
- Alternatives considered:
  - Gửi email trong transaction: sai boundary và tăng latency/risk rollback sai.
  - Tách `audit_logs` khỏi transaction: có thể tạo inconsistency audit.

## 4. Authorization model

- Decision: Check permission chính ở route/guard và check whitelist role assignment ở service/policy layer.
- Rationale: Phù hợp clarification “không cần tất cả permission nhỏ lẻ” nhưng vẫn giữ boundary rule nghiệp vụ.
- Alternatives considered:
  - Chỉ check route scope: bỏ sót rule gán role.
  - Encode tất cả vào permission matrix nhỏ lẻ: trái clarification.

## 5. Password bootstrap handling

- Decision: Temporary password chỉ tồn tại trong application memory, hash trước khi persist, không trả qua API response.
- Rationale: Phù hợp security clarification và giảm rủi ro lộ credential.
- Alternatives considered:
  - Lưu plaintext tạm trong DB/cache/queue: vi phạm clarification.
  - Bỏ temporary password và dùng reset flow ngay: mở rộng scope sang use case khác.
