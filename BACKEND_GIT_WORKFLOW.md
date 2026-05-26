# Backend Git Workflow Guide

Tài liệu này dùng để thống nhất cách làm việc giữa các thành viên backend và các AI coding agent khi code project. Mục tiêu là tránh đè code nhau, dễ review, dễ rollback, và giữ lịch sử commit sạch theo từng module/task.

---

## 1. Branching Strategy

Repo hiện tại dùng các nhánh chính sau:

```text
main        = nhánh ổn định cuối cùng, chỉ merge khi dev đã ổn

dev         = nhánh tích hợp chung của backend

hai-branch  = nhánh cá nhân của Hai

tai-branch  = nhánh cá nhân của Tài
```

Quy tắc:

- Không code trực tiếp trên `main`.
- Không push trực tiếp lên `main`.
- Mỗi người code trên branch cá nhân của mình.
- Khi làm xong task/module, tạo Pull Request từ branch cá nhân vào `dev`.
- Khi `dev` đã ổn định, mới merge từ `dev` vào `main`.

Luồng chuẩn:

```text
hai-branch  ┐
            ├── Pull Request → dev → main
 tai-branch ┘
```

---

## 2. Trước khi bắt đầu code

Trước khi code task mới, luôn đồng bộ branch cá nhân với `dev`.

```bash
git checkout dev
git pull origin dev

git checkout hai-branch
# hoặc: git checkout tai-branch

git merge dev
```

Nếu có conflict ở bước này, xử lý conflict trước rồi mới code tiếp.

Không nên code trên branch cá nhân quá lâu mà không merge/pull `dev`, vì càng lâu conflict càng nhiều.

---

## 3. Commit theo task/module, không commit theo từng file lẻ

Một commit nên đại diện cho **một thay đổi có ý nghĩa**.

Ví dụ tốt:

```bash
git commit -m "feat(device-user-mapping): add camera user mapping table"
```

Commit này có thể bao gồm nhiều file, miễn là tất cả phục vụ cùng một task/module:

```text
src/**/*.entity.ts
src/database/migrations/...
src/modules/device-user-mappings/device-user-mappings.module.ts
src/modules/device-user-mappings/device-user-mappings.service.ts
src/modules/device-user-mappings/device-user-mappings.controller.ts
src/modules/device-user-mappings/dto/create-device-user-mapping.dto.ts
```

Ví dụ không tốt:

```bash
git commit -m "update code"
git commit -m "fix"
git commit -m "done"
git commit -m "add files"
```

Cũng không nên gom quá nhiều thứ không liên quan vào một commit, ví dụ:

```text
- sửa auth
- thêm attendance
- đổi schema database
- sửa meeting service
- format toàn bộ project
```

Nếu commit có quá nhiều chữ “và”, hãy tách commit.

---

## 4. Quy ước commit message

Dùng format:

```text
type(scope): message
```

Trong đó:

```text
type  = loại thay đổi
scope = module hoặc khu vực bị ảnh hưởng
message = mô tả ngắn gọn bằng tiếng Anh
```

Các `type` thường dùng:

```text
feat      = thêm chức năng mới
fix       = sửa bug
refactor  = refactor code, không đổi logic nghiệp vụ
chore     = config, package, setup, việc phụ
docs      = tài liệu
test      = test
db        = thay đổi database/schema/migration
style     = format code, không đổi logic
```

Ví dụ commit message nên dùng:

```bash
feat(device): add face server device model
feat(device-user-mapping): map face server users to system users
feat(attendance): handle face verification callback
feat(room-tracking): process room occupancy snapshots
fix(attendance): prevent duplicate check-in records
refactor(meeting): extract active meeting lookup service
chore(db): add device user mapping migration
docs(api): update attendance callback payload example
```

---

## 5. Không dùng `git add .` bừa bãi

Không nên dùng `git add .` như thói quen mặc định.

Trước khi add file, luôn kiểm tra:

```bash
git status
git diff --stat
```

Nên add theo file hoặc folder liên quan đến task:

```bash
git add src/modules/attendance
git add src/modules/attendance/entities
git add src/database/migrations
```

Chỉ dùng `git add .` khi đã chắc chắn **tất cả thay đổi hiện tại đều thuộc cùng một commit**.

Trước khi commit, kiểm tra lại:

```bash
git status
git diff --cached --stat
```

Tuyệt đối không commit nhầm các file sau:

```text
.env
.env.local
node_modules/
dist/
build/
coverage/
*.log
file test cá nhân
file backup tạm
```

Nếu lỡ add nhầm file:

```bash
git restore --staged <file-name>
```

---

## 6. Quy trình code chuẩn mỗi task

Ví dụ Hai làm task `device-user-mapping`:

```bash
# 1. Đồng bộ dev
git checkout dev
git pull origin dev

# 2. Sang branch cá nhân
git checkout hai-branch
git merge dev

# 3. Code task
# ...

# 4. Kiểm tra thay đổi
git status
git diff --stat

# 5. Add đúng file/module
git add src/modules/device-user-mappings
git add src/modules/device-user-mappings/entities
git add src/database/migrations

# 6. Kiểm tra staged changes
git diff --cached --stat

# 7. Commit
git commit -m "feat(device-user-mapping): add camera user mapping module"

# 8. Push branch cá nhân
git push origin hai-branch
```

Sau đó lên GitHub tạo Pull Request:

```text
hai-branch → dev
```

---

## 7. Pull Request rules

Mỗi Pull Request nên tương ứng với một task/module rõ ràng.

PR title nên theo format gần giống commit:

```text
feat(attendance): handle face verification callback
```

PR description nên có:

```text
## What changed
- Added endpoint to receive face verification events
- Stored raw camera payload into iot_device_events
- Mapped camera user to system user via device_user_mappings

## How to test
- Run backend locally
- Configure Face Server HTTP Subscription to backend IP and port
- Scan face on device
- Check attendance_events and attendance_records

## Notes
- Requires device_user_mappings table migration
```

Không merge PR nếu:

- Project không chạy.
- Migration thiếu hoặc lỗi.
- Code làm ảnh hưởng module của người khác mà chưa báo.
- Có file `.env`, log, hoặc file tạm bị commit nhầm.

---

## 8. Quy tắc với database và TypeORM

Nếu sửa database, commit phải bao gồm đủ Entity và Migration tương ứng:

```text
src/**/*.entity.ts
src/database/migrations/...
```

Ví dụ:

```bash
git add src/modules/device-user-mappings/entities src/database/migrations
git commit -m "feat(db): add device user mappings table"
```

Không nên chỉ commit Entity file (`*.entity.ts`) mà quên tạo và commit file Migration.

Trước khi sửa các file Entity dùng chung, nên báo người còn lại vì đây là file rất dễ conflict.

Nếu 2 người cùng cần sửa database, nên thống nhất trước:

```text
- Ai sửa bảng nào?
- Tên file Migration là gì?
- Có ảnh hưởng quan hệ khóa ngoại không?
- Có cần seed data không?
```

Ví dụ tạo migration bằng TypeORM CLI nên có tên rõ ràng:

```bash
npm run typeorm migration:generate src/database/migrations/add_device_user_mappings
```

---

## 9. Chia module để hạn chế conflict

Nên chia backend theo module rõ ràng.

Gợi ý chia việc:

```text
Người 1:
- devices
- device_user_mappings
- camera HTTP subscription callback
- iot_device_events

Người 2:
- meetings
- attendance_records
- attendance_events
- room_booking_usages
- no_show_cases
```

Các file dễ conflict cần báo nhau trước khi sửa:

```text
src/**/*.entity.ts
src/app.module.ts
src/main.ts
package.json
.env.example
README.md
```

Nếu phải sửa file chung, hãy nói trước trong nhóm.

---

## 10. Checklist trước khi push

Trước khi push, chạy checklist:

```text
[ ] Đang ở đúng branch cá nhân chưa?
[ ] Đã pull/merge dev mới nhất chưa?
[ ] Code có chạy không?
[ ] Có commit nhầm .env/log/file tạm không?
[ ] Commit message đúng format chưa?
[ ] Migration có được commit cùng schema không?
[ ] Có sửa file chung mà chưa báo người khác không?
[ ] PR description có hướng dẫn test không?
```

Command kiểm tra nhanh:

```bash
git branch
git status
git diff --stat
git diff --cached --stat
```

---

## 11. Quick command reference

Xem branch hiện tại:

```bash
git branch
```

Đổi branch:

```bash
git checkout hai-branch
```

Pull code mới nhất:

```bash
git pull origin dev
```

Merge dev vào branch cá nhân:

```bash
git checkout hai-branch
git merge dev
```

Xem file đã thay đổi:

```bash
git status
```

Xem tóm tắt thay đổi:

```bash
git diff --stat
```

Add folder/module:

```bash
git add src/modules/attendance
```

Gỡ file đã add nhầm:

```bash
git restore --staged <file-name>
```

Commit:

```bash
git commit -m "feat(attendance): handle face verification callback"
```

Push:

```bash
git push origin hai-branch
```

---
