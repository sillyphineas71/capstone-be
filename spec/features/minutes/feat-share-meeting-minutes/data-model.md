# Data Model: Share Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo data-model cho feat-share-meeting-minutes | Toàn bộ file |

## 1. Bảng mới: `meeting_minutes_shares`

| Column | Type | Constraint | Ghi chú |
| :--- | :--- | :--- | :--- |
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `minutes_id` | uuid | NOT NULL, FK → `meeting_minutes.id` ON DELETE CASCADE | |
| `user_id` | uuid | NOT NULL, FK → `users.id` ON DELETE CASCADE | Người được cấp quyền xem |
| `granted_by` | uuid | NOT NULL, FK → `users.id` | Người thực hiện grant (Host/Preparer/Admin) |
| `granted_at` | timestamptz | NOT NULL, default `now()` | |

**Constraints**:
- `UNIQUE (minutes_id, user_id)` — 1 user chỉ có tối đa 1 dòng share/1 biên bản.
- Index `(minutes_id)` — phục vụ query `listMinutesShares` và nhánh mới trong `canAccessMinutes()`.
- Index `(user_id)` — phục vụ query "biên bản nào đang share cho tôi" nếu cần ở feature sau (không dùng trong phạm vi feature này, nhưng index rẻ, hữu ích sẵn).

**TypeORM Entity** (`MeetingMinutesShareEntity`):
```ts
@Entity('meeting_minutes_shares')
@Unique(['minutesId', 'userId'])
export class MeetingMinutesShareEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'minutes_id', type: 'uuid' })
  minutesId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'granted_by', type: 'uuid' })
  grantedBy: string;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @ManyToOne(() => MeetingMinutesEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'minutes_id' })
  minutes: MeetingMinutesEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'granted_by' })
  grantedByUser: UserEntity;
}
```

## 2. Bảng bị ảnh hưởng (chỉ đọc)

### 2.1 `meeting_minutes` (entity: `MeetingMinutesEntity`, đã có sẵn)
Đọc `id`, `status`, `prepared_by`, `meeting_id`. Không ghi.

### 2.2 `meetings` (entity: `MeetingEntity`, đã có sẵn)
Đọc `host_id` (ownership check). Không ghi.

### 2.3 `users` (entity: `UserEntity`, đã có sẵn)
Đọc `id`, `account_status`, `full_name`, `email` — validate target user + build response (`userFullName`/`userEmail`/`grantedByName`).

### 2.4 `audit_logs` (entity: `AuditLogEntity`, đã có sẵn)
1 dòng/lần grant hoặc revoke thành công: `action_type ∈ {meeting_minutes_shared, meeting_minutes_unshared}`, `entity_type=meeting_minutes`, `entity_id=<minutesId>`, `metadata_json={targetUserId, grantedBy/revokedBy}`.

## 3. Thay đổi code cho entity/hàm hiện có

### 3.1 Entity mới
`src/modules/minutes/entities/meeting-minutes-share.entity.ts` (mới hoàn toàn).

### 3.2 Sửa `canAccessMinutes()` — chuyển sync → async (xem research.md mục 5)
```ts
// TRƯỚC (sync)
private canAccessMinutes(...): boolean { ... }

// SAU (async — thêm nhánh share)
private async canAccessMinutes(...): Promise<boolean> {
  ...
  if (isHost || isParticipant) return true;
  const shareCount = await this.dataSource
    .getRepository(MeetingMinutesShareEntity)
    .count({ where: { minutesId: minutes.id, userId } });
  return shareCount > 0;
  ...
}
```
Cả 2 call-site (`findMinutesDetail`, `loadMinutesForReadCheck`) phải thêm `await` trước lời gọi.

## 4. Response Shape

```ts
interface MinutesShareData {
  id: string;
  minutesId: string;
  userId: string;
  userFullName: string;
  grantedBy: string;
  grantedAt: string; // ISO datetime
}

interface MinutesShareListData {
  minutesId: string;
  shares: Array<{
    id: string;
    userId: string;
    userFullName: string;
    userEmail: string;
    grantedBy: string;
    grantedByName: string;
    grantedAt: string;
  }>;
}

interface UnshareResponseData {
  minutesId: string;
  userId: string;
  revoked: true;
}
```

## 5. State Diagram
```text
[chưa share] --(POST .../shares, status=published)--> [đang share]
[đang share] --(DELETE .../shares/:userId, status=published)--> [chưa share]
[đang share] --(minutes chuyển published → archived)--> [đang share] (KHÔNG đổi — xem FR-011)
```
Không có state machine riêng cho bản ghi share — chỉ tồn tại (share) hoặc không tồn tại (không share), không có trạng thái trung gian.

## 6. Migration Cần Thiết
1. `CreateMeetingMinutesSharesTable` — `CREATE TABLE` + `UNIQUE` + 2 index theo mục 1.
2. `SeedMeetingMinutesSharePermissions` — seed 3 permission (xem plan.md mục 4.3).

Đây là **feature đầu tiên trong module `minutes`** cần migration schema thật (`CREATE TABLE`), khác mọi feature `minutes` trước đó (chỉ seed permission trên bảng có sẵn) — cần review kỹ hơn bình thường trước khi chạy `migration:run` trên môi trường chia sẻ.
