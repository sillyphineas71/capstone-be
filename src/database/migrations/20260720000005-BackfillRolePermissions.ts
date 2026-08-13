import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill role_permissions cho toan bo permission da duoc seed, doi voi 4 role loi
 * (SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE) vua duoc tao o 20260720000002.
 *
 * BOI CANH: ~130 file trong src/database/migrations + src/database/seeds da seed
 * permission tu 2026-06-08 den 2026-07-18, nhung KHONG role nao ton tai tai thoi diem
 * do (xem huong-dan-setup-be-cho-nhom.md muc 8) - nen moi cau
 * "INSERT INTO role_permissions ... SELECT r.id, ... FROM roles r WHERE r.role_code = $1"
 * deu tra ve 0 dong, am tham khong lam gi (khong loi). Ket qua: 119 permission_code da
 * ton tai trong bang permissions nhung KHONG co role_permissions nao gan voi 4 role loi.
 *
 * DU LIEU DUOI DAY duoc trich xuat CO HOC (khong doan) tu toan bo cac file seed that,
 * gop theo permission_code (mot permission co the duoc cap role o nhieu file khac nhau
 * theo thoi gian - vi du FixMinutesAttachmentEmployeeRole them EMPLOYEE cho permission
 * da co tu truoc). Da ap dung 2 alias ro rang tu chinh comment cua cac migration nguon:
 *   - 'ADMIN' -> 'SYSTEM_ADMIN' (vai tro admin toan he thong, ten cu truoc khi chuan hoa)
 *   - 'INTERNAL_USER' -> 'EMPLOYEE' (xac nhan tuong minh trong
 *     20260624000002-SeedProfileAvatarPermissions.ts: spec.md dung INTERNAL_USER nhung
 *     bang roles thuc te dung EMPLOYEE, migration dung EMPLOYEE de khop dung du lieu that)
 *   - 'ROOM_ADMIN' bi bo qua (chi xuat hien 1 lan, khong co role nao thuc su ten nay,
 *     va permission do (meeting.participant.override_capacity) da co SYSTEM_ADMIN roi)
 *
 * 9 permission_code sau day dang duoc @RequirePermissions() tham chieu trong controller
 * nhung CHUA TUNG duoc seed o bat ky migration/seed nao - gap co that cua du an (tuong tu
 * gap da duoc ghi nhan trong 20260703010000-SeedLiveMeetingAttendancePresencePermissions.ts).
 * Migration nay tao moi luon 9 permission do voi role hop ly suy tu permission cung nhom
 * (vi du meeting.create -> giong meeting.cancel.own: EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN):
 * admin.manage_permissions, permission.read, accounts.user.create, account.user.read.detail,
 * anpr.vehicle.history_view, anpr.vehicle.unknown_view, anpr.vehicle.admin_register,
 * meeting.create, scheduling.suggest.rooms.
 *
 * Idempotent hoan toan: permission insert dung WHERE NOT EXISTS, role_permissions insert
 * dung WHERE NOT EXISTS. An toan chay lai nhieu lan.
 */
export class BackfillRolePermissions20260720000005 implements MigrationInterface {
  name = 'BackfillRolePermissions20260720000005';

  private readonly entries: Array<{
    code: string;
    module: string;
    name: string;
    roles: string[];
  }> = [
    {
      code: 'account.avatar.download',
      module: 'accounts',
      name: 'Tai anh avatar submission',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.avatar.review',
      module: 'accounts',
      name: 'Xem va duyet/tu choi avatar',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.role.create',
      module: 'accounts',
      name: 'Tao role moi',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.role.delete',
      module: 'accounts',
      name: 'Xoa role',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.role.read',
      module: 'accounts',
      name: 'Xem role',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.role.update',
      module: 'accounts',
      name: 'Cap nhat role',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'account.user.read.detail',
      module: 'accounts',
      name: 'Xem chi tiet nguoi dung',
      roles: ['EMPLOYEE', 'BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.create',
      module: 'accounts',
      name: 'Tao tai khoan nguoi dung',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.delete',
      module: 'accounts',
      name: 'Xóa tài khoản người dùng',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.import',
      module: 'accounts',
      name: 'Import tài khoản nhân viên bằng Excel',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.list',
      module: 'accounts',
      name: 'Tìm kiếm/danh sách người dùng',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.lock',
      module: 'accounts',
      name: 'Khóa tài khoản',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.manage',
      module: 'accounts',
      name: 'Quản trị/lọc danh sách tài khoản',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.unlock',
      module: 'accounts',
      name: 'Mở khóa tài khoản',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.update',
      module: 'accounts',
      name: 'Cập nhật thông tin tài khoản',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.update_roles',
      module: 'accounts',
      name: 'Cập nhật vai trò tài khoản',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'accounts.user.update_status',
      module: 'accounts',
      name: 'Cập nhật trạng thái tài khoản',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'admin.manage_permissions',
      module: 'accounts',
      name: 'Quan ly permission he thong',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'analytics.attendance.read',
      module: 'analytics',
      name: 'Xem thong ke ty le tham du dung gio',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'analytics.meeting.read',
      module: 'analytics',
      name: 'Xem thong ke cuoc hop',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'analytics.overview.read',
      module: 'analytics',
      name: 'Xem dashboard tong quan he thong',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'analytics.room.read',
      module: 'analytics',
      name: 'Xem dashboard su dung phong hop',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'anpr.vehicle.admin_register',
      module: 'anpr',
      name: 'Dang ky bien so ho user (admin)',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'anpr.vehicle.history_view',
      module: 'anpr',
      name: 'Xem lich su ra vao bien so (admin)',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'anpr.vehicle.unknown_view',
      module: 'anpr',
      name: 'Xem danh sach bien so la (admin)',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'attendance.invalidate',
      module: 'attendance',
      name: 'Vô hiệu hóa bản ghi điểm danh',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'attendance.manual.create',
      module: 'attendance',
      name: 'Tạo bản ghi điểm danh thủ công',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'attendance.manual.update',
      module: 'attendance',
      name: 'Cập nhật bản ghi điểm danh thủ công',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'attendance.read',
      module: 'live-meeting',
      name: 'Xem trang thai diem danh cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'audit.system.read',
      module: 'audit',
      name: 'Xem nhat ky kiem tra he thong',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'department.create',
      module: 'accounts',
      name: 'Tạo phòng ban',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'department.read',
      module: 'accounts',
      name: 'Liệt kê phòng ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'equipment.assign',
      module: 'equipment',
      name: 'Phân bổ thiết bị vào phòng',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'equipment.create',
      module: 'equipment',
      name: 'Đăng ký thiết bị họp mới',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'equipment.delete',
      module: 'equipment',
      name: 'Xóa thiết bị',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'equipment.read',
      module: 'equipment',
      name: 'Xem / tìm kiếm kho thiết bị',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'equipment.report_fault',
      module: 'equipment',
      name: 'Báo lỗi / chuyển bảo trì thiết bị',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'face.stranger.read',
      module: 'face_access',
      name: 'Xem cảnh báo người lạ',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'face.unmapped.map',
      module: 'face_access',
      name: 'Liên kết person Face Server với user',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'face.unmapped.read',
      module: 'face_access',
      name: 'Xem person chưa map',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'iot_devices:assign_room',
      module: 'iot',
      name: 'Gán thiết bị vào phòng họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'iot_devices:configure_face_server',
      module: 'iot',
      name: 'Cấu hình / xoay token Face Server',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'iot_devices:configure_rtsp',
      module: 'iot',
      name: 'Cấu hình RTSP cho IP Camera',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'iot_devices:create',
      module: 'iot',
      name: 'Đăng ký thiết bị IoT/Camera',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.check_availability',
      module: 'iot',
      name: 'Kiểm tra trạng thái khả dụng của camera',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.disable',
      module: 'iot',
      name: 'Vô hiệu hóa thiết bị IoT',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.enable',
      module: 'iot',
      name: 'Kích hoạt lại thiết bị IoT',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.probe',
      module: 'iot',
      name: 'Probe trạng thái online/offline thiết bị IoT',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.read',
      module: 'iot',
      name: 'Xem danh sách / chi tiết thiết bị IoT',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'iot.device.update',
      module: 'iot',
      name: 'Cập nhật thông tin thiết bị IoT',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'ivss.health.read',
      module: 'ivss',
      name: 'Xem tình trạng IVSS',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      // [FIX 2026-08-13] Thêm BUSINESS_ADMIN + EMPLOYEE — xem
      // 20260704000002-SeedCameraDomainRbacPermissions.ts.
      code: 'ivss.presence.read',
      module: 'ivss',
      name: 'Xem presence từ IVSS',
      roles: ['MANAGER', 'SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'EMPLOYEE'],
    },
    {
      code: 'meeting_request.approve',
      module: 'meetings',
      name: 'Phê duyệt yêu cầu cuộc họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting_request.read',
      module: 'meetings',
      name: 'Xem yêu cầu cuộc họp',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting_request.reject',
      module: 'meetings',
      name: 'Từ chối yêu cầu cuộc họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.cancel.any',
      module: 'meetings',
      name: 'Hủy bất kỳ cuộc họp nào',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.cancel.own',
      module: 'meetings',
      name: 'Hủy cuộc họp của mình',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.create',
      module: 'meetings',
      name: 'Tao cuoc hop moi',
      roles: ['EMPLOYEE', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.extension.request.own',
      module: 'live-meeting',
      name: 'Yêu cầu gia hạn phiên họp',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.ai_draft.create',
      module: 'minutes',
      name: 'Tao bien ban hop nhap bang AI',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.attachment.create',
      module: 'minutes',
      name: 'Dinh kem tai lieu vao bien ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.attachment.delete',
      module: 'minutes',
      name: 'Go tai lieu dinh kem khoi bien ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.attachment.read',
      module: 'minutes',
      name: 'Xem danh sach tai lieu dinh kem cua bien ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.create',
      module: 'minutes',
      name: 'Tao bien ban hop nhap',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.delete',
      module: 'minutes',
      name: 'Xoa bien ban hop nhap',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.export',
      module: 'minutes',
      name: 'Xuat bien ban cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.issue',
      module: 'minutes',
      name: 'Ban hanh bien ban hop chinh thuc',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.link_resources',
      module: 'minutes',
      name: 'Lien ket recording/transcript voi bien ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.read',
      module: 'minutes',
      name: 'Xem danh sach bien ban hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.search_by_person',
      module: 'minutes',
      name: 'Tim kiem bien ban hop theo nhan su',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.share.create',
      module: 'minutes',
      name: 'Chia se bien ban cho nguoi dung cu the',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.share.delete',
      module: 'minutes',
      name: 'Thu hoi quyen xem bien ban da chia se',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.share.read',
      module: 'minutes',
      name: 'Xem danh sach chia se cua bien ban',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.update',
      module: 'minutes',
      name: 'Cap nhat bien ban hop nhap',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.note.create',
      module: 'live-meeting',
      name: 'Tao ghi chu trong cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.note.read',
      module: 'live-meeting',
      name: 'Xem ghi chu trong cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.add.external',
      module: 'meetings',
      name: 'Thêm khách mời bên ngoài cuộc họp',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.add.internal',
      module: 'meetings',
      name: 'Thêm thành viên nội bộ cuộc họp',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.import',
      module: 'meetings',
      name: 'Import thành viên cuộc họp bằng Excel',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.override_capacity',
      module: 'meetings',
      name: 'Ghi đè sức chứa phòng họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.remove',
      module: 'meetings',
      name: 'Gỡ bỏ thành viên nội bộ cuộc họp',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.participant.remove.external',
      module: 'meetings',
      name: 'Gỡ bỏ khách mời bên ngoài cuộc họp',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.presence.read',
      module: 'live-meeting',
      name: 'Xem danh sach nguoi tham du dang co mat',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.room.update',
      module: 'meetings',
      name: 'Cập nhật phòng họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.session.end',
      module: 'live-meeting',
      name: 'Ket thuc phien hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.session.end.any',
      module: 'live-meeting',
      name: 'Ket thuc phien hop - tat ca',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.session.extension.decide',
      module: 'live-meeting',
      name: 'Phê duyệt/từ chối yêu cầu gia hạn',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.session.extension.override',
      module: 'live-meeting',
      name: 'Override yêu cầu gia hạn',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.session.start',
      module: 'live-meeting',
      name: 'Bắt đầu phiên họp',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.time.update',
      module: 'meetings',
      name: 'Cập nhật thời gian cuộc họp',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.time.update.any',
      module: 'meetings',
      name: 'Cập nhật thời gian mọi cuộc họp',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.timeline.read',
      module: 'live-meeting',
      name: 'Xem timeline cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'minutes.distribute',
      module: 'minutes',
      name: 'Phan phoi bien ban hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'notification.cancellation.send',
      module: 'notifications',
      name: 'Gui lai thong bao huy hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'notification.invite.send',
      module: 'notifications',
      name: 'Gui thu moi hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'notification.read.self',
      module: 'notifications',
      name: 'Xem thong bao ca nhan',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'notification.reminder.send',
      module: 'notifications',
      name: 'Gui nhac lich hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'permission.read',
      module: 'accounts',
      name: 'Xem danh sach permission',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'profile.avatar.read_status',
      module: 'accounts',
      name: 'Xem trạng thái avatar của chính mình',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'profile.avatar.submit',
      module: 'accounts',
      name: 'Tự nộp/nộp lại avatar của chính mình',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.config.create',
      module: 'recording',
      name: 'Tạo cấu hình ghi âm/ghi hình',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.config.read',
      module: 'recording',
      name: 'Xem cấu hình ghi âm/ghi hình',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.config.update',
      module: 'recording',
      name: 'Cập nhật cấu hình ghi âm/ghi hình',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.files.manage',
      module: 'recording',
      name: 'Quản lý hiển thị file phương tiện',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.files.play',
      module: 'recording',
      name: 'Phát lại file phương tiện',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.files.read',
      module: 'recording',
      name: 'Xem danh sách/chi tiết file phương tiện',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.upload_track',
      module: 'recording',
      name: 'Upload audio track cho meeting',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.video.start',
      module: 'recording',
      name: 'Bắt đầu ghi hình từ IP camera',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.video.status',
      module: 'recording',
      name: 'Xem trạng thái ghi hình',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'recording.video.stop',
      module: 'recording',
      name: 'Dừng ghi hình từ IP camera',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'report.meeting_activity.export',
      module: 'reports',
      name: 'Xuat bao cao hoat dong cuoc hop',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'report.room_utilization.export',
      module: 'reports',
      name: 'Xuat bao cao su dung phong hop',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.create',
      module: 'rooms',
      name: 'Tạo phòng họp',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.delete',
      module: 'rooms',
      name: 'Xóa phòng họp',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.early_vacancy.configure',
      module: 'rooms',
      name: 'Cấu hình luật early-vacancy',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'room.noshow.configure',
      module: 'rooms',
      name: 'Cấu hình luật no-show',
      roles: ['SYSTEM_ADMIN'],
    },
    {
      code: 'room.noshow.read',
      module: 'rooms',
      name: 'Liệt kê no-show case',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.noshow.release',
      module: 'rooms',
      name: 'Giải phóng phòng do no-show',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.noshow.update',
      module: 'rooms',
      name: 'Cập nhật trạng thái no-show',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.update',
      module: 'rooms',
      name: 'Cập nhật thông tin phòng họp',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'room.utilization.read',
      module: 'rooms',
      name: 'Xem trạng thái sử dụng phòng realtime',
      roles: ['BUSINESS_ADMIN', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'schedule.read.self',
      module: 'meetings',
      name: 'Xem lich ca nhan',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'scheduling.conflict.participant.check',
      module: 'scheduling',
      name: 'Kiểm tra xung đột lịch người tham gia',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'scheduling.suggest.rooms',
      module: 'scheduling',
      name: 'Goi y phong hop phu hop',
      roles: ['EMPLOYEE', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'scheduling.suggest.times',
      module: 'scheduling',
      name: 'Goi y khung gio hop toi uu',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'transcript.create',
      module: 'transcription',
      name: 'Tao transcription job',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'transcript.read',
      module: 'transcription',
      name: 'Xem transcript cuoc hop',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
    {
      code: 'transcript.update',
      module: 'transcription',
      name: 'Sua transcript thu cong',
      roles: ['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      // Neu permission chua ton tai (9 gap moi phat hien), tao moi voi mo ta toi thieu.
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [e.code, e.name, e.module, e.code.split('.').pop() || 'action'],
      );

      const permRow = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [e.code],
      )) as Array<{ id: string }>;
      const permissionId = permRow[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of e.roles) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2::uuid, NOW()
           FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
             AND NOT EXISTS (
               SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
             );`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Chi go role_permissions duoc migration nay them; KHONG xoa permissions vi phan lon
    // da ton tai truoc migration nay (thuoc so huu cua cac migration seed goc).
    const codes = this.entries.map((e) => e.code);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [codes],
    );
    // Xoa rieng 9 permission moi ma migration nay tao ra (khong thuoc migration nao khac).
    const newlyCreated = [
      'admin.manage_permissions',
      'permission.read',
      'accounts.user.create',
      'account.user.read.detail',
      'anpr.vehicle.history_view',
      'anpr.vehicle.unknown_view',
      'anpr.vehicle.admin_register',
      'meeting.create',
      'scheduling.suggest.rooms',
    ];
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [newlyCreated],
    );
  }
}
