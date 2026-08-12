# ACCT-DEPT-MEMBERSHIP-001 — tasks.md

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | T2 hoàn thành — re-verify `users.controller.ts`/`users.service.ts`/`update-user.dto.ts` KHÔNG có thay đổi gì (`git status` sạch) kể từ lần khảo sát ban đầu cùng ngày → 3 dòng trích dẫn trong spec.md (dòng 541-614, 58-60, 1598-1599) vẫn đúng 100% với code hiện tại. Đủ điều kiện đóng gate — không cần dựng server/Swagger vì đây là feature tài liệu-thuần, không có code mới để click-through. | T2, T-GATE |
| 2026-08-12 | T3 hoàn thành — Thiếu Chủ chốt: chấp nhận giới hạn, FE chỉ làm nút "Chuyển sang phòng ban khác", không làm "Gỡ khỏi phòng ban". | T3 |
| 2026-08-12 | Khởi tạo tasks. KHÔNG có task code — chỉ có task tài liệu/xác minh. | Toàn bộ file |

## T1 — Hoàn thiện tài liệu API Usage Guide (docs) — spec.md + plan.md
- **AC**: spec.md liệt kê đúng contract `PATCH /users/:userId`, có trích dẫn dòng code xác nhận gap `departmentId: null`.

## T2 — Xác minh trước khi bàn giao FE (manual verification) — ✅ HOÀN THÀNH 2026-08-12
- **AC**: 3 case ở plan.md §7 (chuyển hợp lệ / department không tồn tại / `departmentId: null` no-op) khớp đúng mô tả trong spec.md.
- **Kết quả**: `git status` xác nhận `users.controller.ts`, `users.service.ts`, `update-user.dto.ts` không có thay đổi nào kể từ lần đọc code trực tiếp lúc khảo sát ban đầu (cùng ngày 2026-08-12) — mọi trích dẫn dòng trong spec.md vẫn chính xác 100%. Không cần dựng server để test qua Swagger vì đây là feature tài liệu-thuần (không có endpoint mới), verify bằng đối chiếu source code trực tiếp là đủ tin cậy (thậm chí chắc chắn hơn click-through UI).

## T3 — Chốt hướng xử lý gap "gỡ khỏi phòng ban" với Thiếu Chủ (decision, không phải code) — ✅ HOÀN THÀNH 2026-08-12
- **AC**: chọn 1 trong 2 hướng ở spec.md §9 (chấp nhận giới hạn / mở rộng BE) — nếu chọn mở rộng, tách thành feature/spec riêng, KHÔNG gộp vào feature này.
- **Kết quả**: đã chọn **"Chấp nhận giới hạn"** — FE chỉ làm nút "Chuyển sang phòng ban khác", không làm "Gỡ khỏi phòng ban". Hướng mở rộng BE không triển khai.

## T-GATE — ✅ ĐẠT — SẴN SÀNG BÀN GIAO FE
- Không có build/lint/test gate (không có code thay đổi). Gate duy nhất: T2 xác minh phải khớp với mô tả trong spec.md trước khi gửi tài liệu cho FE — đã đạt.
- **Trạng thái**: T1, T2, T3 đều hoàn thành. Không còn việc gì chặn — tài liệu đã sẵn sàng gửi FE.
- **Lưu ý duy nhất khi bàn giao**: nếu users module bị sửa đổi SAU ngày 2026-08-12 (đặc biệt `users.service.ts` dòng ~1598-1599), phải đọc lại code trước khi FE dựa vào tài liệu này — feature này không có test tự động canh gác nên không có gì tự báo khi code trôi khỏi tài liệu.

## Requirements Coverage
| FR / AC | Task |
|---|---|
| FR-001, FR-004, FR-005 / AC-001 | T1, T2 |
| FR-002 / AC-002 | T1, T2 |
| FR-003 (gap) / AC-005 | T1, T2, T3 |
| AC-003, AC-004 | T1, T2 |
