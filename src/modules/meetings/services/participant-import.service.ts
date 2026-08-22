import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import * as ExcelJS from 'exceljs';

import {
  MeetingsService,
  AuthUser,
  ClientContext,
} from './meetings.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { buildMeetingInviteEmail } from '../../mail/templates/builders.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingVisibilityLevel,
} from '../entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { UserRoleEntity } from '../../accounts/entities/user-role.entity.js';
import { MEETING_INELIGIBLE_ROLE_CODES } from '../../../common/utils/meeting-ineligible-roles.util.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_FILE_BYTES,
  XLSX_MIME,
  IMPORT_PARTICIPANTS_COLUMNS,
  IMPORT_PARTICIPANTS_HEADERS,
  IMPORT_PARTICIPANTS_HEADER_ALIASES,
  IMPORT_PARTICIPANT_TYPE_ALIASES,
  ImportColumnKey,
  ImportParticipantType,
  ImportRowStatus,
  ImportRowReason,
  ImportRequestError,
} from '../constants/import-participants.constants.js';
import {
  ImportParticipantsReportDto,
  ImportRowResult,
} from '../dto/import-participants-response.dto.js';

interface ParsedRow {
  row: number;
  type: string;
  email: string;
  employeeCode: string;
  fullName: string;
  organizationName: string;
  phoneNumber: string;
}

interface RowState {
  parsed: ParsedRow;
  result: ImportRowResult;
  /** Loại đã chốt sau bước tra cứu người dùng; null khi dòng lỗi ngay từ đầu. */
  kind: ImportParticipantType | null;
  /**
   * Loại do người dùng khai tường minh ở cột "Loại" (chỉ file legacy 7 cột còn cột này).
   * null = không khai -> hệ thống tự đoán theo kết quả tra cứu Email/Mã nhân viên.
   */
  declaredKind: ImportParticipantType | null;
  resolvedUserId?: string;
  isHardError: boolean;
  isWarning: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ParticipantImportService {
  private readonly logger = new Logger(ParticipantImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly meetingsService: MeetingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  //  Template generation
  // ════════════════════════════════════════════════════════════════

  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartTracking System';
    workbook.created = new Date();

    // Sheet/tiêu đề phải khớp 1-1 với file mẫu sinh ở BookMeeting.jsx (downloadSampleExcel)
    // — 1 định dạng duy nhất cho cả booking lẫn Meeting Detail.
    const sheet = workbook.addWorksheet('DanhSach');
    sheet.columns = IMPORT_PARTICIPANTS_COLUMNS.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.key === 'email' ? 28 : 24,
    }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' },
      };
      cell.border = { bottom: { style: 'thin' } };
    });

    sheet.addRow({
      email: 'nhanvien@smrmpts.com',
      employee_code: '',
      full_name: '',
      organization_name: '',
      phone_number: '',
    });
    sheet.addRow({
      email: '',
      employee_code: 'EMP0123',
      full_name: '',
      organization_name: '',
      phone_number: '',
    });
    sheet.addRow({
      email: 'khach@doitac.com',
      employee_code: '',
      full_name: 'Nguyen Van B',
      organization_name: 'Cong ty ABC',
      phone_number: '0900000000',
    });

    const guide = workbook.addWorksheet('HuongDan');
    guide.columns = [{ width: 24 }, { width: 74 }];
    const guideRows: [string, string][] = [
      ['Cột', 'Mô tả'],
      [
        'Email',
        'Nhân viên: định danh chính (ưu tiên). Khách ngoài: email liên hệ (bắt buộc)',
      ],
      ['Mã nhân viên', 'Nhân viên: tùy chọn (dùng khi không có email)'],
      ['Họ và tên', 'Khách ngoài: bắt buộc'],
      ['Tổ chức/Công ty', 'Khách ngoài: tùy chọn'],
      ['Số điện thoại', 'Khách ngoài: tùy chọn'],
      [
        'Cách nhận diện',
        'Hệ thống tự tra Email/Mã nhân viên: khớp một tài khoản trong hệ thống = nhân viên nội bộ; không khớp = khách ngoài (bắt buộc điền Họ và tên).',
      ],
      [
        'Lưu ý',
        'Chỉ tài khoản nội bộ có vai trò Nhân viên (Employee) hoặc Quản lý (Manager) mới được thêm làm người tham dự. Tài khoản Business Admin / System Admin sẽ bị từ chối (dòng lỗi ROLE_NOT_ALLOWED).',
      ],
    ];
    guideRows.forEach((r, idx) => {
      const row = guide.addRow(r);
      if (idx === 0) row.font = { bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ════════════════════════════════════════════════════════════════
  //  Import orchestration
  // ════════════════════════════════════════════════════════════════

  async importParticipants(
    meetingId: string,
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
    options: { forceAddWithWarnings?: boolean },
    authUser: AuthUser,
    clientContext: ClientContext,
  ): Promise<ImportParticipantsReportDto> {
    // ── Step 0: File validation ──
    this.validateFile(file);

    // ── Meeting validation + authorization ──
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }
    if (
      meeting.status !== MeetingStatus.SCHEDULED &&
      meeting.status !== MeetingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Cuộc họp không ở trạng thái cho phép thêm thành viên',
        error: {
          code: 'INVALID_MEETING_STATUS',
          details: {
            currentStatus: meeting.status,
            allowedStatuses: ['scheduled', 'in_progress'],
          },
        },
      });
    }
    await this.assertCanManageParticipants(meeting, authUser.userId);

    // ── Step 1: Parse ──
    const rows = await this.parseWorkbook(file!.buffer);

    // ── Step 2: Static per-row validation ──
    const states: RowState[] = rows.map((parsed) =>
      this.staticValidate(parsed),
    );

    // ── Step 3: Resolve internal + duplicate detection ──
    await this.resolveAndDetectDuplicates(meetingId, states);

    // ── Step 4: Warning evaluation ──
    await this.evaluateWarnings(meeting, states, authUser.userId);

    // ── Step 5: Two-step gate ──
    // [2026-08-23] Gate mở rộng cho CẢ dòng lỗi (trước đây chỉ chặn khi có cảnh báo):
    // file có lỗi vẫn được commit âm thầm phần hợp lệ và FE báo "thành công", người dùng
    // không hề biết dòng nào rớt. Nay mọi file "không sạch" đều trả preview 422 để người
    // dùng xem trước rồi mới quyết định — đúng luồng của màn Đặt lịch họp.
    const warningCount = states.filter((s) => s.isWarning).length;
    const errorCount = states.filter((s) => s.isHardError).length;
    if (
      (warningCount > 0 || errorCount > 0) &&
      options.forceAddWithWarnings !== true
    ) {
      throw new UnprocessableEntityException({
        success: false,
        message:
          errorCount > 0
            ? 'Tệp có dòng không hợp lệ. Vui lòng xem lại và xác nhận.'
            : 'Có dòng cảnh báo. Vui lòng xem lại và xác nhận.',
        error: {
          code: ImportRequestError.WARNING_CONFIRMATION_REQUIRED,
          details: {
            totalRows: states.length,
            // successCount ở preview = số dòng SẼ được thêm nếu người dùng xác nhận.
            successCount: states.length - errorCount,
            warningCount,
            errorCount,
            failedCount: errorCount,
            results: states.map((s) => s.result),
          },
        },
      });
    }

    // ── Step 6: Commit (per-row transaction) ──
    const addedInternalUserIds: string[] = [];
    const addedExternalEmails: string[] = [];

    for (const state of states) {
      if (state.isHardError) {
        state.result.status = ImportRowStatus.FAILED;
        continue;
      }
      try {
        if (state.kind === ImportParticipantType.INTERNAL) {
          const participantId = await this.dataSource.transaction((em) =>
            this.meetingsService.persistInternalParticipantCore(
              em,
              meetingId,
              state.resolvedUserId!,
              authUser.userId,
              clientContext,
            ),
          );
          state.result.status = ImportRowStatus.SUCCESS;
          state.result.participantId = participantId;
          state.result.reason = undefined;
          addedInternalUserIds.push(state.resolvedUserId!);
        } else {
          const participantId = await this.dataSource.transaction((em) =>
            this.meetingsService.persistExternalParticipantCore(
              em,
              meetingId,
              {
                fullName: state.parsed.fullName,
                email: state.parsed.email,
                organizationName: state.parsed.organizationName || null,
                phoneNumber: state.parsed.phoneNumber || null,
              },
              authUser.userId,
              clientContext,
            ),
          );
          state.result.status = ImportRowStatus.SUCCESS;
          state.result.participantId = participantId;
          state.result.reason = undefined;
          addedExternalEmails.push(state.parsed.email);
        }
      } catch (error: unknown) {
        state.result.status = ImportRowStatus.FAILED;
        state.result.reason = this.extractErrorCode(error);
        this.logger.error(
          `[ParticipantImport] Row ${state.result.row} failed: ${(error as Error).message}`,
        );
      }
    }

    // ── Step 7: Notifications (best-effort) ──
    await this.dispatchNotifications(
      meeting,
      addedInternalUserIds,
      addedExternalEmails,
      authUser.userId,
    );

    // ── Step 8: Audit tổng + return ──
    const successCount = states.filter(
      (s) => s.result.status === ImportRowStatus.SUCCESS,
    ).length;
    const failedCount = states.filter(
      (s) => s.result.status === ImportRowStatus.FAILED,
    ).length;

    await this.writeImportAudit(meetingId, authUser.userId, clientContext, {
      totalRows: states.length,
      successCount,
      failedCount,
      warningCount,
    });

    return new ImportParticipantsReportDto({
      totalRows: states.length,
      successCount,
      failedCount,
      warningCount,
      results: states.map((s) => s.result),
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════

  private validateFile(
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
  ): void {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        success: false,
        message: 'Vui lòng tải lên tệp Excel (.xlsx)',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }
    const isXlsxMime = file.mimetype === XLSX_MIME;
    const isXlsxName = (file.originalname ?? '')
      .toLowerCase()
      .endsWith('.xlsx');
    if (!isXlsxMime && !isXlsxName) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp không đúng định dạng .xlsx',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }
    if ((file.size ?? file.buffer.length) > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp vượt quá dung lượng cho phép',
        error: {
          code: ImportRequestError.FILE_TOO_LARGE,
          details: { maxBytes: MAX_IMPORT_FILE_BYTES },
        },
      });
    }
  }

  private async assertCanManageParticipants(
    meeting: MeetingEntity,
    actorId: string,
  ): Promise<void> {
    if (meeting.visibilityLevel !== MeetingVisibilityLevel.PRIVATE) {
      return;
    }
    const isOwner =
      meeting.organizerId === actorId || meeting.hostId === actorId;
    if (isOwner) {
      return;
    }
    const isAdmin = await this.meetingsService.checkUserPermission(
      actorId,
      'admin.all',
    );
    if (!isAdmin) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thêm thành viên vào cuộc họp này',
        error: {
          code: 'FORBIDDEN_ACCESS',
          details: {
            reason: 'Meeting là Private và bạn không phải Organizer/Host/Admin',
          },
        },
      });
    }
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'Không đọc được tệp Excel',
        error: { code: ImportRequestError.INVALID_FILE_FORMAT, details: {} },
      });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không có sheet dữ liệu',
        error: { code: ImportRequestError.INVALID_TEMPLATE, details: {} },
      });
    }

    // Validate header theo TÊN cột (không theo vị trí) — chấp nhận template mới 5 cột,
    // template legacy 7 cột (STT/Loại) và file bị đổi thứ tự cột; nhưng vẫn chặn khi
    // người dùng tự ý thêm cột lạ.
    const headerRow = sheet.getRow(1);
    const columnIndex = new Map<ImportColumnKey, number>();
    const unknownHeaders: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const raw = this.cellString(headerRow.getCell(c));
      if (!raw) continue;
      const key = IMPORT_PARTICIPANTS_HEADER_ALIASES[raw.toLowerCase()];
      if (!key) {
        unknownHeaders.push(raw);
        continue;
      }
      if (!columnIndex.has(key)) columnIndex.set(key, c);
    }

    const hasIdentifierColumn =
      columnIndex.has('email') || columnIndex.has('employee_code');
    if (unknownHeaders.length > 0 || !hasIdentifierColumn) {
      throw new BadRequestException({
        success: false,
        message: 'Sai nguyên mẫu. Vui lòng không tự ý thêm/đổi tên cột.',
        error: {
          code: ImportRequestError.INVALID_TEMPLATE,
          details: {
            expectedHeaders: IMPORT_PARTICIPANTS_HEADERS,
            unknownHeaders,
            actualColumnCount: sheet.columnCount,
          },
        },
      });
    }

    const rows: ParsedRow[] = [];
    const lastRow = sheet.rowCount;
    const cellOf = (excelRow: ExcelJS.Row, key: ImportColumnKey): string => {
      const idx = columnIndex.get(key);
      return idx ? this.cellString(excelRow.getCell(idx)) : '';
    };
    for (let r = 2; r <= lastRow; r++) {
      const excelRow = sheet.getRow(r);
      // Cột STT (nếu có) chỉ để tham khảo, không dùng trong logic.
      const rawType = cellOf(excelRow, 'type').toLowerCase();
      const type = IMPORT_PARTICIPANT_TYPE_ALIASES[rawType] ?? rawType;
      const email = cellOf(excelRow, 'email').toLowerCase();
      const employeeCode = cellOf(excelRow, 'employee_code');
      const fullName = cellOf(excelRow, 'full_name');
      const organizationName = cellOf(excelRow, 'organization_name');
      const phoneNumber = cellOf(excelRow, 'phone_number');

      // Bỏ qua dòng hoàn toàn trống, hoặc chỉ điền mỗi STT mà các cột khác trống
      if (
        !type &&
        !email &&
        !employeeCode &&
        !fullName &&
        !organizationName &&
        !phoneNumber
      ) {
        continue;
      }

      rows.push({
        row: r,
        type,
        email,
        employeeCode,
        fullName,
        organizationName,
        phoneNumber,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp không có dữ liệu',
        error: { code: ImportRequestError.INVALID_TEMPLATE, details: {} },
      });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Tệp vượt quá số dòng tối đa (${MAX_IMPORT_ROWS})`,
        error: {
          code: ImportRequestError.IMPORT_ROW_LIMIT_EXCEEDED,
          details: { maxRows: MAX_IMPORT_ROWS, actual: rows.length },
        },
      });
    }

    return rows;
  }

  /**
   * Validate tĩnh (chưa chạm DB). Template mới KHÔNG có cột "Loại" nên phần lớn dòng
   * sẽ ở trạng thái "auto" (declaredKind = null) — loại thật được chốt ở bước
   * resolveAndDetectDuplicates sau khi tra Email/Mã nhân viên, giống hệt logic của
   * màn Đặt lịch họp (BookMeeting.jsx -> handleExcelImport).
   */
  private staticValidate(parsed: ParsedRow): RowState {
    const isInternal =
      parsed.type === (ImportParticipantType.INTERNAL as string);
    const isExternal =
      parsed.type === (ImportParticipantType.EXTERNAL as string);
    const declaredKind = isInternal
      ? ImportParticipantType.INTERNAL
      : isExternal
        ? ImportParticipantType.EXTERNAL
        : null;
    const identifier =
      parsed.email || parsed.employeeCode || parsed.fullName || '';

    const result: ImportRowResult = {
      row: parsed.row,
      type: declaredKind ?? 'unknown',
      identifier,
      status: ImportRowStatus.VALID,
    };
    const state: RowState = {
      parsed,
      result,
      kind: declaredKind,
      declaredKind,
      isHardError: false,
      isWarning: false,
    };

    // File legacy: cột "Loại" có điền nhưng sai giá trị -> lỗi như cũ.
    if (!declaredKind && parsed.type) {
      return this.markError(state, ImportRowReason.INVALID_ROW_TYPE);
    }

    if (declaredKind === ImportParticipantType.EXTERNAL) {
      if (
        !parsed.fullName ||
        !parsed.email ||
        !EMAIL_REGEX.test(parsed.email)
      ) {
        return this.markError(state, ImportRowReason.INVALID_EXTERNAL_ROW);
      }
      return state;
    }

    // internal tường minh HOẶC auto: phải có ít nhất 1 định danh hợp lệ để tra cứu.
    if (!parsed.email && !parsed.employeeCode) {
      return this.markError(state, ImportRowReason.MISSING_IDENTIFIER);
    }
    if (parsed.email && !EMAIL_REGEX.test(parsed.email)) {
      return this.markError(state, ImportRowReason.INVALID_EMAIL);
    }

    return state;
  }

  private async resolveAndDetectDuplicates(
    meetingId: string,
    states: RowState[],
  ): Promise<void> {
    // Dòng cần tra cứu tài khoản nội bộ: khai tường minh "Nội bộ" HOẶC để hệ thống tự đoán.
    const lookupStates = states.filter(
      (s) =>
        !s.isHardError && s.declaredKind !== ImportParticipantType.EXTERNAL,
    );

    // ── Resolve internal users (batch) ──
    if (lookupStates.length > 0) {
      const emails = lookupStates.map((s) => s.parsed.email).filter((e) => !!e);
      const codes = lookupStates
        .map((s) => s.parsed.employeeCode)
        .filter((c) => !!c);

      const users = await this.dataSource.getRepository(UserEntity).find({
        where: [
          ...(emails.length ? [{ email: In(emails) }] : []),
          ...(codes.length ? [{ employeeCode: In(codes) }] : []),
        ],
      });
      const activeUsers = users.filter(
        (u) => u.accountStatus === AccountStatus.ACTIVE && !u.deletedAt,
      );
      const byEmail = new Map<string, UserEntity>();
      const byCode = new Map<string, UserEntity>();
      for (const u of activeUsers) {
        if (u.email) byEmail.set(u.email.toLowerCase(), u);
        if (u.employeeCode) byCode.set(u.employeeCode, u);
      }

      for (const s of lookupStates) {
        const user =
          (s.parsed.email && byEmail.get(s.parsed.email)) ||
          (s.parsed.employeeCode && byCode.get(s.parsed.employeeCode)) ||
          null;
        if (user) {
          s.kind = ImportParticipantType.INTERNAL;
          s.result.type = ImportParticipantType.INTERNAL;
          s.resolvedUserId = user.id;
          continue;
        }
        if (s.declaredKind === ImportParticipantType.INTERNAL) {
          this.markError(s, ImportRowReason.USER_NOT_FOUND);
          continue;
        }
        // Auto: không khớp tài khoản nào -> coi là khách ngoài, khi đó Họ và tên
        // là bắt buộc (giống BookMeeting.jsx).
        s.kind = ImportParticipantType.EXTERNAL;
        s.result.type = ImportParticipantType.EXTERNAL;
        if (
          !s.parsed.fullName ||
          !s.parsed.email ||
          !EMAIL_REGEX.test(s.parsed.email)
        ) {
          this.markError(s, ImportRowReason.INVALID_EXTERNAL_ROW);
        }
      }
    }

    const internalStates = states.filter(
      (s) => !s.isHardError && s.kind === ImportParticipantType.INTERNAL,
    );
    const externalStates = states.filter(
      (s) => !s.isHardError && s.kind === ImportParticipantType.EXTERNAL,
    );

    if (internalStates.length > 0) {
      // [2026-08-21] Chặn import Business Admin / System Admin làm participant —
      // hệ thống chỉ cho phép Employee/Manager tham dự cuộc họp.
      const resolvedIdsForRoleCheck = internalStates
        .filter((s) => !s.isHardError && s.resolvedUserId)
        .map((s) => s.resolvedUserId!);
      if (resolvedIdsForRoleCheck.length > 0) {
        const ineligibleUserIds = await this.getIneligibleMeetingUserIds(
          resolvedIdsForRoleCheck,
        );
        for (const s of internalStates) {
          if (
            !s.isHardError &&
            s.resolvedUserId &&
            ineligibleUserIds.has(s.resolvedUserId)
          ) {
            this.markError(s, ImportRowReason.ROLE_NOT_ALLOWED);
          }
        }
      }

      // Duplicate-in-file (internal) theo resolvedUserId
      const seenUserIds = new Set<string>();
      for (const s of internalStates) {
        if (s.isHardError || !s.resolvedUserId) continue;
        if (seenUserIds.has(s.resolvedUserId)) {
          this.markError(s, ImportRowReason.DUPLICATE_IN_FILE);
        } else {
          seenUserIds.add(s.resolvedUserId);
        }
      }

      // Duplicate-in-DB (internal)
      const resolvedIds = internalStates
        .filter((s) => !s.isHardError && s.resolvedUserId)
        .map((s) => s.resolvedUserId!);
      if (resolvedIds.length > 0) {
        const existing = await this.dataSource
          .getRepository(MeetingParticipantEntity)
          .find({ where: { meetingId, userId: In(resolvedIds) } });
        const existingSet = new Set(existing.map((p) => p.userId));
        for (const s of internalStates) {
          if (
            !s.isHardError &&
            s.resolvedUserId &&
            existingSet.has(s.resolvedUserId)
          ) {
            this.markError(s, ImportRowReason.PARTICIPANT_ALREADY_EXISTS);
          }
        }
      }
    }

    // ── External duplicate detection ──
    if (externalStates.length > 0) {
      // Duplicate-in-file (external) theo email
      const seenEmails = new Set<string>();
      for (const s of externalStates) {
        if (s.isHardError) continue;
        if (seenEmails.has(s.parsed.email)) {
          this.markError(s, ImportRowReason.DUPLICATE_IN_FILE);
        } else {
          seenEmails.add(s.parsed.email);
        }
      }

      // Duplicate-in-DB (external)
      const emails = externalStates
        .filter((s) => !s.isHardError)
        .map((s) => s.parsed.email);
      if (emails.length > 0) {
        const existing = await this.dataSource
          .getRepository(MeetingExternalParticipantEntity)
          .createQueryBuilder('ep')
          .where('ep.meetingId = :meetingId', { meetingId })
          .andWhere('LOWER(ep.email) IN (:...emails)', { emails })
          .getMany();
        const existingSet = new Set(
          existing.map((p) => (p.email ?? '').toLowerCase()),
        );
        for (const s of externalStates) {
          if (!s.isHardError && existingSet.has(s.parsed.email)) {
            this.markError(s, ImportRowReason.PARTICIPANT_ALREADY_EXISTS);
          }
        }
      }
    }
  }

  private async evaluateWarnings(
    meeting: MeetingEntity,
    states: RowState[],
    actorId: string,
  ): Promise<void> {
    const validInternal = states.filter(
      (s) =>
        !s.isHardError &&
        s.kind === ImportParticipantType.INTERNAL &&
        s.resolvedUserId,
    );
    if (validInternal.length === 0) return;

    // ── Schedule conflict ──
    const userIds = validInternal.map((s) => s.resolvedUserId!);
    const conflictResult = await this.meetingsService.checkParticipantConflicts(
      userIds,
      meeting.startTime,
      meeting.endTime,
    );
    const conflictUserIds = new Set(
      conflictResult.conflicts.map((c) => c.userId),
    );
    for (const s of validInternal) {
      if (conflictUserIds.has(s.resolvedUserId!)) {
        this.markWarning(s, ImportRowReason.SCHEDULE_CONFLICT);
      }
    }

    // ── Room capacity (cumulative) ──
    if (!meeting.roomId) return;
    const room = await this.dataSource
      .getRepository(RoomEntity)
      .findOne({ where: { id: meeting.roomId } });
    if (!room) return;

    const currentCount = await this.meetingsService.getAttendeeCount(
      meeting.id,
    );
    const capacity = room.capacity;
    if (currentCount + validInternal.length <= capacity) {
      return;
    }

    const policy = await this.getCapacityPolicy();
    const canOverride =
      policy === 'warning'
        ? await this.meetingsService.checkUserPermission(
            actorId,
            'meeting.participant.override_capacity',
          )
        : false;

    // Đánh dấu các dòng vượt sức chứa theo thứ tự xuất hiện
    let seat = currentCount;
    for (const s of validInternal) {
      seat += 1;
      if (seat <= capacity) continue;
      if (policy === 'block' || !canOverride) {
        this.markError(s, ImportRowReason.ROOM_CAPACITY_EXCEEDED);
      } else {
        this.markWarning(s, ImportRowReason.ROOM_CAPACITY_WARNING);
      }
    }
  }

  private async getCapacityPolicy(): Promise<string> {
    const config = await this.dataSource
      .getRepository(SystemConfigEntity)
      .findOne({
        where: { configKey: 'meeting.capacity_policy', isActive: true },
      });
    return (config?.configValue as string) ?? 'warning';
  }

  private async dispatchNotifications(
    meeting: MeetingEntity,
    internalUserIds: string[],
    externalEmails: string[],
    actorId: string,
  ): Promise<void> {
    // Internal: 1 in-app notification gom, KHÔNG email
    if (internalUserIds.length > 0) {
      try {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.IN_APP,
          subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
          content: `Bạn đã được thêm vào cuộc họp "${meeting.title}".`,
          relatedEntityType: 'meeting',
          relatedEntityId: meeting.id,
          recipientScope: 'user_list',
          recipientUserIds: internalUserIds,
          payloadJson: { invitedBy: actorId, source: 'excel_import' },
          createdBy: actorId,
        });
      } catch (err: unknown) {
        this.logger.error(
          `[ParticipantImport] Failed to create in-app notification: ${(err as Error).message}`,
        );
      }
    }

    // External: email riêng từng khách
    for (const email of externalEmails) {
      try {
        await this.notificationsService.enqueueEmailNotification({
          notificationType: NotificationType.MEETING_INVITE,
          channel: NotificationChannel.EMAIL,
          subject: `Lời mời tham gia cuộc họp: ${meeting.title}`,
          content: `Bạn được mời tham gia cuộc họp "${meeting.title}".`,
          emailHtml: buildMeetingInviteEmail({
            meetingTitle: meeting.title,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
          }),
          toEmails: [email],
          relatedEntityType: 'meeting',
          relatedEntityId: meeting.id,
          recipientScope: 'user_list',
          payloadJson: { invitedBy: actorId, source: 'excel_import' },
          createdBy: actorId,
        });
      } catch (err: unknown) {
        this.logger.error(
          `[ParticipantImport] Failed to enqueue external email to ${email}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async writeImportAudit(
    meetingId: string,
    actorId: string,
    clientContext: ClientContext,
    summary: {
      totalRows: number;
      successCount: number;
      failedCount: number;
      warningCount: number;
    },
  ): Promise<void> {
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: actorId,
        actionType: 'IMPORT_PARTICIPANTS',
        entityType: 'meeting',
        entityId: meetingId,
        newValueJson: summary,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        severity: AuditLogSeverity.INFO,
      });
    } catch (err: unknown) {
      this.logger.error(
        `[ParticipantImport] Failed to write import audit: ${(err as Error).message}`,
      );
    }
  }

  // ── Small utilities ──

  /** Trả về tập userId đang giữ role BUSINESS_ADMIN/SYSTEM_ADMIN (không được tham dự họp). */
  private async getIneligibleMeetingUserIds(
    userIds: string[],
  ): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(UserRoleEntity)
      .createQueryBuilder('ur')
      .innerJoin('ur.role', 'r')
      .where('ur.userId IN (:...userIds)', { userIds })
      .andWhere('ur.isActive = :isActive', { isActive: true })
      .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > NOW())')
      .andWhere('r.roleCode IN (:...codes)', {
        codes: MEETING_INELIGIBLE_ROLE_CODES,
      })
      .select('ur.userId', 'userId')
      .getRawMany<{ userId: string }>();
    return new Set(rows.map((r) => r.userId));
  }

  private markError(state: RowState, reason: ImportRowReason): RowState {
    state.isHardError = true;
    state.isWarning = false;
    state.result.status = ImportRowStatus.ERROR;
    state.result.reason = reason;
    return state;
  }

  private markWarning(state: RowState, reason: ImportRowReason): void {
    if (state.isHardError || state.isWarning) return;
    state.isWarning = true;
    state.result.status = ImportRowStatus.WARNING;
    state.result.reason = reason;
  }

  private cellString(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return '';
    // ExcelJS Cell.text trả về biểu diễn văn bản đã format (kể cả hyperlink/rich text).
    const text = cell.text;
    return (typeof text === 'string' ? text : '')
      .replace(/^mailto:/i, '')
      .trim();
  }

  private extractErrorCode(error: unknown): string {
    const resp = (error as { response?: { error?: { code?: string } } })
      ?.response;
    return resp?.error?.code ?? 'IMPORT_ROW_FAILED';
  }
}
