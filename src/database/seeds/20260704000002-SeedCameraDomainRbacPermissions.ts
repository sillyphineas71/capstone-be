import { DataSource } from 'typeorm';

/**
 * Seed RBAC hợp nhất cho toàn bộ camera-domain, áp role-set theo RBAC_Camera_Decisions.
 *
 * Role thật (xác nhận trực tiếp từ DB): SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE.
 * KHÔNG tồn tại ADMIN/ROOM_ADMIN — tuyệt đối không dùng.
 *
 * File này là NGUỒN SỰ THẬT DUY NHẤT cho role-mapping camera-domain, gồm 2 nhóm:
 *
 *  (A) OWNED_PERMISSIONS — permission chỉ được định nghĩa tại đây (không có file seed
 *      granular khác): INSERT permission (ON CONFLICT DO NOTHING) + gán role.
 *
 *  (B) EXTERNAL_ROLE_GRANTS — permission đã được định nghĩa ở file seed/migration khác
 *      (iot.device.*, recording.*, transcript.create, attendance.manual.*, ...). Ở đây
 *      CHỈ SELECT theo permission_code rồi gán role theo RBAC doc — KHÔNG tạo lại permission.
 *      Lý do gom về đây: các file granular gán role cho ADMIN (không tồn tại) và chỉ gán
 *      role lúc INSERT lần đầu (không re-apply), nên đổi mảng role ở đó vô hiệu trên DB
 *      đã seed. Gán tập trung ở đây có fallback SELECT-existing → luôn áp đúng, idempotent.
 *
 * LƯU Ý (additive): seed chỉ THÊM mapping (ON CONFLICT DO NOTHING), KHÔNG thu hồi mapping cũ.
 *   Ví dụ iot.device.* trước đây đã lỡ gán MANAGER (từ file granular) sẽ KHÔNG tự bị gỡ.
 *   Nếu cần khớp tuyệt đối "chỉ SYSTEM_ADMIN", cần một bước REVOKE riêng (chờ duyệt).
 *
 * TRẠNG THÁI: đã wire vào `scripts/run-seeds.ts` — CHƯA chạy vào DB.
 */

interface CameraPermissionSeed {
  code: string;
  name: string;
  moduleCode: string;
  actionCode: string;
  description: string;
  /** Role-set theo RBAC_Camera_Decisions */
  roles: string[];
}

/** Permission đã định nghĩa nơi khác — chỉ gán role tại đây (không INSERT permission). */
interface ExternalRoleGrant {
  code: string;
  roles: string[];
}

// ── (A) Permission chỉ định nghĩa tại đây: INSERT + gán role ──────────────────
const OWNED_PERMISSIONS: CameraPermissionSeed[] = [
  // ── iot (ghi/cấu hình thiết bị) — SYSTEM_ADMIN ──
  {
    code: 'iot_devices:create',
    name: 'Đăng ký thiết bị IoT/Camera',
    moduleCode: 'iot',
    actionCode: 'device_create',
    description: 'Cho phép tạo mới bản ghi thiết bị IoT/Camera trong hệ thống.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'iot_devices:assign_room',
    name: 'Gán thiết bị vào phòng họp',
    moduleCode: 'iot',
    actionCode: 'device_assign_room',
    description:
      'Cho phép gán/di chuyển thiết bị IoT/Camera vào một phòng họp.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'iot_devices:configure_rtsp',
    name: 'Cấu hình RTSP cho IP Camera',
    moduleCode: 'iot',
    actionCode: 'device_configure_rtsp',
    description:
      'Cho phép cấu hình thông tin kết nối RTSP (URL, credential mã hóa) cho IP camera góc phòng.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'iot_devices:configure_face_server',
    name: 'Cấu hình / xoay token Face Server',
    moduleCode: 'iot',
    actionCode: 'device_configure_face_server',
    description:
      'Cho phép cấu hình kết nối và xoay/thu hồi callback token của Door Face Attendance Terminal.',
    roles: ['SYSTEM_ADMIN'],
  },

  // ── ivss — health: SYSTEM_ADMIN | presence: SYSTEM_ADMIN, MANAGER ──
  {
    code: 'ivss.health.read',
    name: 'Xem tình trạng IVSS',
    moduleCode: 'ivss',
    actionCode: 'health_read',
    description: 'Cho phép xem trạng thái health/kết nối của IVSS. Read-only.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'ivss.presence.read',
    name: 'Xem presence từ IVSS',
    moduleCode: 'ivss',
    actionCode: 'presence_read',
    description:
      'Cho phép xem dữ liệu presence/occupancy do IVSS cung cấp. Read-only.',
    roles: ['SYSTEM_ADMIN', 'MANAGER'],
  },

  // ── rooms — noshow.update/release: +BUSINESS_ADMIN | configure: SYSTEM_ADMIN |
  //    utilization.read: +MANAGER,+BUSINESS_ADMIN | create: +BUSINESS_ADMIN ──
  {
    code: 'room.noshow.update',
    name: 'Cập nhật trạng thái no-show',
    moduleCode: 'rooms',
    actionCode: 'noshow_update',
    description: 'Cho phép cập nhật/giải quyết một trường hợp no-show.',
    roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'],
  },
  {
    code: 'room.noshow.release',
    name: 'Giải phóng phòng do no-show',
    moduleCode: 'rooms',
    actionCode: 'noshow_release',
    description:
      'Cho phép kích hoạt giải phóng phòng khi xác nhận no-show (thao tác thủ công).',
    roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'],
  },
  {
    code: 'room.noshow.configure',
    name: 'Cấu hình luật no-show',
    moduleCode: 'rooms',
    actionCode: 'noshow_configure',
    description:
      'Cho phép xem và cập nhật cấu hình luật đánh giá no-show (ngưỡng thời gian, chính sách).',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'room.early_vacancy.configure',
    name: 'Cấu hình luật early-vacancy',
    moduleCode: 'rooms',
    actionCode: 'early_vacancy_configure',
    description:
      'Cho phép xem và cập nhật cấu hình luật phát hiện phòng trống sớm (early vacancy).',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'room.utilization.read',
    name: 'Xem trạng thái sử dụng phòng realtime',
    moduleCode: 'rooms',
    actionCode: 'utilization_read',
    description:
      'Cho phép xem tổng quan trạng thái phòng realtime và chi tiết trạng thái từng phòng (giám sát). Read-only.',
    roles: ['SYSTEM_ADMIN', 'MANAGER', 'BUSINESS_ADMIN'],
  },
  {
    code: 'room.create',
    name: 'Tạo phòng họp',
    moduleCode: 'rooms',
    actionCode: 'create',
    description: 'Cho phép tạo mới phòng họp.',
    roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'],
  },
  {
    code: 'room.update',
    name: 'Cập nhật thông tin phòng họp',
    moduleCode: 'rooms',
    actionCode: 'update',
    description:
      'Cho phép sửa tên, vị trí, sức chứa, thiết bị tiện ích của phòng họp (UC-ROOM-02).',
    roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'],
  },
  {
    code: 'room.delete',
    name: 'Xóa phòng họp',
    moduleCode: 'rooms',
    actionCode: 'delete',
    description:
      'Cho phép xóa (soft-delete) phòng họp khỏi danh mục không gian khả dụng (UC-ROOM-03).',
    roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'],
  },

  // ── face-access (dữ liệu khuôn mặt nhạy cảm) — SYSTEM_ADMIN ──
  {
    code: 'face.stranger.read',
    name: 'Xem cảnh báo người lạ',
    moduleCode: 'face_access',
    actionCode: 'stranger_read',
    description:
      'Cho phép xem danh sách sự kiện/cảnh báo khuôn mặt lạ (stranger) từ Face Server.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'face.unmapped.read',
    name: 'Xem person chưa map',
    moduleCode: 'face_access',
    actionCode: 'unmapped_read',
    description:
      'Cho phép xem danh sách person trên Face Server chưa được liên kết với user hệ thống.',
    roles: ['SYSTEM_ADMIN'],
  },
  {
    code: 'face.unmapped.map',
    name: 'Liên kết person Face Server với user',
    moduleCode: 'face_access',
    actionCode: 'unmapped_map',
    description:
      'Cho phép ánh xạ một person trên Face Server sang user hệ thống (device_user_mappings).',
    roles: ['SYSTEM_ADMIN'],
  },
];

// ── (B) Permission đã định nghĩa nơi khác — CHỈ gán role tại đây (theo RBAC doc) ──
// Không INSERT permission (tránh trùng / sai metadata). SELECT theo code rồi gán role.
const EXTERNAL_ROLE_GRANTS: ExternalRoleGrant[] = [
  // Nhóm 1 — iot.device.* (granular seeds/migration) → SYSTEM_ADMIN
  { code: 'iot.device.read', roles: ['SYSTEM_ADMIN'] },
  { code: 'iot.device.probe', roles: ['SYSTEM_ADMIN'] },
  { code: 'iot.device.update', roles: ['SYSTEM_ADMIN'] },
  { code: 'iot.device.disable', roles: ['SYSTEM_ADMIN'] },
  { code: 'iot.device.enable', roles: ['SYSTEM_ADMIN'] },
  { code: 'iot.device.check_availability', roles: ['SYSTEM_ADMIN'] },

  // recording.config.* / recording.video.* / transcript.create → SYSTEM_ADMIN, MANAGER
  { code: 'recording.config.create', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'recording.config.read', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'recording.config.update', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'recording.video.start', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'recording.video.stop', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'recording.video.status', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'transcript.create', roles: ['SYSTEM_ADMIN', 'MANAGER'] },

  // recording.files.read/play + recording.upload_track → SYSTEM_ADMIN, MANAGER, EMPLOYEE
  {
    code: 'recording.files.read',
    roles: ['SYSTEM_ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    code: 'recording.files.play',
    roles: ['SYSTEM_ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    code: 'recording.upload_track',
    roles: ['SYSTEM_ADMIN', 'MANAGER', 'EMPLOYEE'],
  },

  // recording.files.manage → SYSTEM_ADMIN, BUSINESS_ADMIN
  { code: 'recording.files.manage', roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'] },

  // attendance.manual.* / attendance.invalidate → SYSTEM_ADMIN, MANAGER
  { code: 'attendance.manual.create', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'attendance.manual.update', roles: ['SYSTEM_ADMIN', 'MANAGER'] },
  { code: 'attendance.invalidate', roles: ['SYSTEM_ADMIN', 'MANAGER'] },

  // attendance.read (Việc 2 — ĐÃ seed sẵn bởi live-meeting migration với đúng 3 role;
  // gán lại ở đây để idempotent-reinforce, KHÔNG tạo permission trùng).
  {
    code: 'attendance.read',
    roles: ['SYSTEM_ADMIN', 'MANAGER', 'BUSINESS_ADMIN'],
  },
];

export async function seedCameraDomainRbacPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // (A) OWNED: INSERT permission (ON CONFLICT DO NOTHING) + gán role.
    for (const perm of OWNED_PERMISSIONS) {
      const permResult = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [
          perm.code,
          perm.name,
          perm.moduleCode,
          perm.actionCode,
          perm.description,
        ],
      );

      let permissionId = permResult[0]?.id;

      if (!permissionId) {
        const existing = await queryRunner.query(
          `SELECT id FROM permissions WHERE permission_code = $1;`,
          [perm.code],
        );
        permissionId = existing[0]?.id;
      }

      if (!permissionId) {
        continue;
      }

      for (const roleCode of perm.roles) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );

        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, permissionId],
          );
        }
      }
    }

    // (B) EXTERNAL: permission đã có nơi khác — CHỈ SELECT theo code rồi gán role.
    for (const grant of EXTERNAL_ROLE_GRANTS) {
      const existing = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [grant.code],
      );
      const permissionId = existing[0]?.id;

      if (!permissionId) {
        // Permission chưa tồn tại (file seed/migration gốc chưa chạy) → bỏ qua,
        // sẽ được gán khi seed/migration gốc chạy. Không tự tạo permission ở đây.
        continue;
      }

      for (const roleCode of grant.roles) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );

        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, permissionId],
          );
        }
      }
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
